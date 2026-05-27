const { query, body, param, validationResult } = require('express-validator');
const pool = require('../../config/db');
const { logVendorAudit } = require('../../services/vendorAuditLogService');

/** Matches purchaseOrders.controller.js — keep in sync for PO line_items parsing */
function parseLineItemsJson(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseExtraObj(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return typeof p === 'object' && p !== null && !Array.isArray(p) ? p : {};
    } catch {
      return {};
    }
  }
  return {};
}

function oldSerialFromExtra(extraRaw) {
  const ex = parseExtraObj(extraRaw);
  const direct = ex.old_serial_number ?? ex.old_serial;
  if (direct != null && String(direct).trim() !== '') return String(direct).trim();
  const blob = ex.dataoldSerialNumber;
  if (blob == null) return '';
  let obj = blob;
  if (typeof blob === 'string') {
    try {
      obj = JSON.parse(blob);
    } catch {
      return '';
    }
  }
  if (obj && obj.oldSerial != null) return String(obj.oldSerial).trim();
  return '';
}

function uniqueDisplayFromRow(row) {
  const ex = parseExtraObj(row.extra);
  if (row.inventory_asset_code) return String(row.inventory_asset_code);
  if (ex.unique_product_serial) return String(ex.unique_product_serial);
  if (ex.unique_number) return String(ex.unique_number);
  return '';
}

function lineSummaryForSerial(lineItems, extraRaw) {
  const lines = Array.isArray(lineItems) ? lineItems : [];
  const ex = parseExtraObj(extraRaw);
  const idx = ex.line_index !== undefined && ex.line_index !== null ? Number(ex.line_index) : NaN;
  let line = null;
  if (Number.isFinite(idx) && idx >= 0 && lines[idx]) line = lines[idx];
  if (!line) {
    const pd = ex.product_detail_id ?? ex.pro_id ?? ex.product_id;
    if (pd !== undefined && pd !== null && String(pd).trim() !== '') {
      const k = String(pd);
      line = lines.find(
        (l) =>
          String(l.product_detail_id ?? l.product_id ?? l.pro_id ?? l.id ?? '') === k
      );
    }
  }
  if (!line && lines.length === 1) line = lines[0];
  if (!line) return '';
  const brand = line.brand_name ?? line.brand ?? '';
  const model = line.product_name ?? line.model ?? '';
  const specs = line.attributes_text ?? line.specs ?? '';
  const title = [brand, model].filter(Boolean).join(' ').trim();
  if (!title) return specs ? String(specs) : '';
  return specs ? `${title} (${specs})` : title;
}

/**
 * Laravel inventoryList($status === 'replace'): serial_numbers.status2 = 'replace'
 * CRM: column inventory_status or extra.status2 / extra.inventory_status
 */
const INVENTORY_REPLACE_SQL = `(
  s.inventory_status = 'replace'
  OR (
    (s.inventory_status IS NULL OR TRIM(COALESCE(s.inventory_status, '')) = '')
    AND (
      COALESCE(NULLIF(TRIM(s.extra->>'inventory_status'), ''), '') = 'replace'
      OR COALESCE(NULLIF(TRIM(s.extra->>'status2'), ''), '') = 'replace'
    )
  )
)`;

const listInventoryValidators = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
  query('vendor_id').optional().isInt().toInt(),
  query('search').optional().isString().trim()
];

async function listInventorySerials(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const page = req.query.page || 1;
  const limit = req.query.limit || 25;
  const offset = (page - 1) * limit;

  const fromSql = `
    FROM vendor_serial_numbers s
    INNER JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
    LEFT JOIN vendors v ON v.vendor_id = p.vendor_id AND v.deleted_at IS NULL
  `;

  let whereSql = `
    WHERE s.deleted_at IS NULL
    AND s.po_id IS NOT NULL
    AND ${INVENTORY_REPLACE_SQL}
  `;
  const params = [];
  let pi = 1;
  if (req.query.vendor_id) {
    whereSql += ` AND p.vendor_id = $${pi}`;
    params.push(req.query.vendor_id);
    pi += 1;
  }
  const qSearch = (req.query.search || '').trim();
  if (qSearch) {
    whereSql += ` AND (
      s.serial_number ILIKE $${pi}
      OR COALESCE(s.inventory_asset_code, '') ILIKE $${pi}
      OR COALESCE(s.extra->>'unique_product_serial', '') ILIKE $${pi}
      OR COALESCE(s.extra->>'unique_number', '') ILIKE $${pi}
      OR p.purchase_order_number ILIKE $${pi}
      OR COALESCE(v.business_name, '') ILIKE $${pi}
      OR COALESCE(v.first_name, '') ILIKE $${pi}
      OR COALESCE(v.last_name, '') ILIKE $${pi}
      OR COALESCE(s.extra->>'old_serial_number', '') ILIKE $${pi}
      OR COALESCE(s.remark::text, '') ILIKE $${pi}
      OR COALESCE(s.extra->>'remark', '') ILIKE $${pi}
    )`;
    params.push(`%${qSearch}%`);
    pi += 1;
  }

  const cnt = await pool.query(`SELECT COUNT(*)::int AS c ${fromSql} ${whereSql}`, params);
  const total = cnt.rows[0].c;

  const dataSql = `
    SELECT
      s.serial_id,
      s.po_id,
      s.grn_id,
      s.serial_number,
      s.inventory_asset_code,
      s.extra,
      s.qc_status,
      s.inventory_status,
      s.remark,
      s.updated_at,
      p.purchase_order_number,
      p.purchase_order_type,
      p.vendor_id,
      v.business_name,
      v.first_name,
      v.last_name
    ${fromSql}
    ${whereSql}
    ORDER BY s.updated_at DESC
    LIMIT $${pi} OFFSET $${pi + 1}
  `;
  const dataR = await pool.query(dataSql, [...params, limit, offset]);

  const poIds = [...new Set(dataR.rows.map((r) => Number(r.po_id)).filter((n) => Number.isFinite(n)))];
  const lineMap = new Map();
  if (poIds.length) {
    const poR = await pool.query(
      `SELECT po_id, line_items FROM vendor_purchase_orders WHERE po_id = ANY($1::int[]) AND deleted_at IS NULL`,
      [poIds]
    );
    for (const row of poR.rows) {
      lineMap.set(Number(row.po_id), parseLineItemsJson(row.line_items));
    }
  }

  const data = dataR.rows.map((row) => {
    const lines = lineMap.get(Number(row.po_id)) || [];
    const ex = parseExtraObj(row.extra);
    const fromCol = row.remark != null ? String(row.remark).trim() : '';
    const fromExtra = ex.remark != null ? String(ex.remark).trim() : '';
    const remarkResolved = fromCol || fromExtra || '';
    return {
      serial_id: row.serial_id,
      po_id: row.po_id,
      grn_id: row.grn_id,
      serial_number: row.serial_number,
      unique_display: uniqueDisplayFromRow(row) || '—',
      old_serial_number: oldSerialFromExtra(row.extra) || '—',
      remark: remarkResolved || '—',
      qc_status: row.qc_status || ex.qc_status || null,
      inventory_status: row.inventory_status || ex.inventory_status || ex.status2 || 'replace',
      purchase_order_number: row.purchase_order_number,
      purchase_order_type: row.purchase_order_type,
      vendor_id: row.vendor_id,
      vendor_display: [row.business_name, row.first_name].filter(Boolean).join(' · ') || '—',
      line_summary: lineSummaryForSerial(lines, row.extra) || '—',
      updated_at: row.updated_at
    };
  });

  res.json({
    success: true,
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 }
  });
}

const listValidators = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
  query('vendor_id').optional().isInt().toInt(),
  query('po_id').optional().isInt().toInt(),
  query('status').optional().isString().trim(),
  query('search').optional().isString().trim()
];

async function list(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const page = req.query.page || 1;
  const limit = req.query.limit || 25;
  const offset = (page - 1) * limit;
  let where = `deleted_at IS NULL`;
  const p = [];
  let i = 1;
  if (req.query.vendor_id) {
    where += ` AND vendor_id = $${i}`;
    p.push(req.query.vendor_id);
    i++;
  }
  if (req.query.po_id) {
    where += ` AND po_id = $${i}`;
    p.push(req.query.po_id);
    i++;
  }
  if (req.query.status) {
    where += ` AND status = $${i}`;
    p.push(req.query.status);
    i++;
  }
  if ((req.query.search || '').trim()) {
    where += ` AND payload::text ILIKE $${i}`;
    p.push(`%${req.query.search}%`);
    i++;
  }

  const cnt = await pool.query(`SELECT COUNT(*)::int AS c FROM vendor_replaced_products WHERE ${where}`, p);
  const total = cnt.rows[0].c;
  const rows = await pool.query(
    `SELECT * FROM vendor_replaced_products WHERE ${where} ORDER BY replaced_id DESC LIMIT $${i} OFFSET $${i + 1}`,
    [...p, limit, offset]
  );
  res.json({
    success: true,
    data: rows.rows,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 }
  });
}

async function create(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  const b = req.body;
  const ins = await pool.query(
    `INSERT INTO vendor_replaced_products (vendor_id, po_id, payload, status)
     VALUES ($1,$2,$3::jsonb,$4) RETURNING *`,
    [b.vendor_id ?? null, b.po_id ?? null, JSON.stringify(b.payload || {}), b.status || 'open']
  );
  await logVendorAudit({
    actorUserId: req.user?.user_id,
    vendorId: b.vendor_id,
    entityType: 'replaced_product',
    entityId: ins.rows[0].replaced_id,
    action: 'create',
    payload: {}
  });
  res.status(201).json({ success: true, data: ins.rows[0] });
}

const createValidators = [
  body('payload').optional().isObject(),
  body('status').optional().isString(),
  body('vendor_id').optional().isInt().toInt(),
  body('po_id').optional().isInt().toInt()
];

async function getOne(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  const r = await pool.query(
    `SELECT * FROM vendor_replaced_products WHERE replaced_id = $1 AND deleted_at IS NULL`,
    [req.params.id]
  );
  if (!r.rows.length) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, data: r.rows[0] });
}

async function update(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const id = Number(req.params.id);
  const b = req.body;
  const r = await pool.query(
    `UPDATE vendor_replaced_products SET
      vendor_id = COALESCE($1, vendor_id),
      po_id = COALESCE($2, po_id),
      payload = COALESCE($3::jsonb, payload),
      status = COALESCE(NULLIF($4,''), status),
      updated_at = NOW()
     WHERE replaced_id = $5 AND deleted_at IS NULL RETURNING *`,
    [b.vendor_id, b.po_id, b.payload != null ? JSON.stringify(b.payload) : null, b.status ? String(b.status) : '', id]
  );

  if (!r.rows.length) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, data: r.rows[0] });
}

async function remove(req, res) {
  await pool.query(`UPDATE vendor_replaced_products SET deleted_at = NOW() WHERE replaced_id = $1`, [req.params.id]);
  res.json({ success: true });
}

module.exports = {
  listValidators,
  listInventoryValidators,
  createValidators,
  list,
  listInventorySerials,
  getValidators: [param('id').isInt().toInt()],
  create,
  updateValidators: [param('id').isInt().toInt()],
  getOne,
  update,
  remove
};
