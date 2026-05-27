const { query, body, param, validationResult } = require('express-validator');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const pool = require('../../config/db');
const { getTotalAmountOfPurchaseOrder } = require('../../utils/purchaseOrderGst');
const { nextSparePartsPurchaseOrderNumber } = require('../../services/vendorNumberService');
const { logVendorAudit } = require('../../services/vendorAuditLogService');
const { allocateTtsplCodes } = require('../../services/vendorInventoryAssetCodeService');

function lineSubtotal(lineItems) {
  if (!Array.isArray(lineItems)) return 0;
  let s = 0;
  lineItems.forEach((row) => {
    const r = Number(row.rate);
    const q = Number(row.quantity);
    if (!Number.isFinite(r)) return;
    s += r * (Number.isFinite(q) ? q : 0);
  });
  return Math.round(s * 100) / 100;
}

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

/**
 * Laravel view: product_details + receivedQty — count vendor_serial_numbers for this spo_id keyed by extra.line_index / part ids.
 */
async function buildReceivedQtyMapsForSpoIds(spoIds) {
  const map = new Map();
  if (!Array.isArray(spoIds) || !spoIds.length) return map;

  const r = await pool.query(
    `SELECT spo_id, extra FROM vendor_serial_numbers
     WHERE spo_id = ANY($1::int[]) AND deleted_at IS NULL`,
    [spoIds]
  );

  function ensure(sid) {
    if (!map.has(sid)) map.set(sid, { byIdx: {}, byPd: {}, unalloc: 0 });
    return map.get(sid);
  }

  for (const row of r.rows) {
    const sid = Number(row.spo_id);
    const m = ensure(sid);
    const ex =
      row.extra && typeof row.extra === 'object' && row.extra !== null && !Array.isArray(row.extra) ? row.extra : {};
    const liRaw = ex.line_index;
    const pdRaw = ex.product_detail_id ?? ex.pro_id ?? ex.part_id ?? ex.product_id;

    if (liRaw !== undefined && liRaw !== null && String(liRaw).trim() !== '') {
      const li = Number(liRaw);
      if (Number.isFinite(li) && li >= 0) {
        const k = String(li);
        m.byIdx[k] = (m.byIdx[k] || 0) + 1;
        continue;
      }
    }

    if (pdRaw !== undefined && pdRaw !== null && String(pdRaw).trim() !== '') {
      const k = String(pdRaw);
      m.byPd[k] = (m.byPd[k] || 0) + 1;
      continue;
    }

    m.unalloc += 1;
  }

  return map;
}

function enrichSpareLinesWithReceived(lineItems, info) {
  if (!Array.isArray(lineItems) || !info) return lineItems;
  const { byIdx, byPd, unalloc } = info;

  const out = lineItems.map((row, idx) => {
    const preset = Number(row.receivedQty ?? row.received_qty ?? 0) || 0;
    const pd =
      row.product_detail_id ??
      row.part_id ??
      row.product_id ??
      row.pro_id ??
      row.id;
    let computed = 0;
    if (pd != null && String(pd).trim() !== '') {
      const v = byPd[String(pd)];
      if (v != null) computed = v;
    }
    if (!computed && byIdx[String(idx)] != null) computed = byIdx[String(idx)];
    const receivedQty = Math.max(preset, computed || 0);
    return { ...row, receivedQty };
  });

  if (out.length === 1 && unalloc > 0) {
    out[0] = { ...out[0], receivedQty: (Number(out[0].receivedQty) || 0) + unalloc };
  } else if (out.length > 1 && unalloc > 0) {
    const i = out.findIndex((row) => (Number(row.quantity) || 0) > (Number(row.receivedQty) || 0));
    const t = i >= 0 ? i : 0;
    out[t] = { ...out[t], receivedQty: (Number(out[t].receivedQty) || 0) + unalloc };
  }

  return out;
}

function attachSpareProductDetails(spoRow, qtyMaps) {
  const spoId = Number(spoRow.spo_id);
  const lines = parseLineItemsJson(spoRow.line_items);
  const ri = qtyMaps.get(spoId);
  const enriched = enrichSpareLinesWithReceived(lines, ri || { byIdx: {}, byPd: {}, unalloc: 0 });
  return { ...spoRow, line_items: enriched, product_details: enriched };
}

function spareReceiveAllowed(spoRow) {
  const st = String(spoRow?.status || '').toLowerCase();
  return st !== 'void' && st !== 'pending';
}

function formatGrnNumber(grnId) {
  return `GRN-${String(grnId).padStart(4, '0')}`;
}

async function vendorState(vendor_id) {
  const r = await pool.query(`SELECT state FROM vendors WHERE vendor_id = $1 AND deleted_at IS NULL`, [vendor_id]);
  return r.rows[0]?.state || null;
}

const listValidators = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
  query('vendor_id').optional().isInt().toInt(),
  query('search').optional().isString().trim()
];

async function list(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const page = req.query.page || 1;
  const limit = req.query.limit || 25;
  const offset = (page - 1) * limit;
  const vid = req.query.vendor_id;
  const search = (req.query.search || '').trim();

  let where = `sp.deleted_at IS NULL`;
  const p = [];
  let idx = 1;

  if (vid) {
    where += ` AND sp.vendor_id = $${idx}`;
    p.push(vid);
    idx += 1;
  }
  if (search) {
    where += ` AND (
      sp.purchase_order_number ILIKE $${idx}
      OR COALESCE(sp.remarks, '') ILIKE $${idx}
      OR COALESCE(v.business_name, '') ILIKE $${idx}
      OR COALESCE(v.first_name, '') ILIKE $${idx}
    )`;
    p.push(`%${search}%`);
    idx += 1;
  }

  const cnt = await pool.query(
    `SELECT COUNT(*)::int AS c
     FROM vendor_spare_parts_purchase_orders sp
     LEFT JOIN vendors v ON v.vendor_id = sp.vendor_id AND v.deleted_at IS NULL
     WHERE ${where}`,
    p
  );
  const total = cnt.rows[0].c;

  const data = await pool.query(
    `SELECT
       sp.*,
       v.first_name AS vendor_first_name,
       v.business_name AS vendor_business_name,
       COALESCE(NULLIF(TRIM(v.business_name), ''), NULLIF(TRIM(v.first_name), ''), '') AS vendor_display_name
     FROM vendor_spare_parts_purchase_orders sp
     LEFT JOIN vendors v ON v.vendor_id = sp.vendor_id AND v.deleted_at IS NULL
     WHERE ${where}
     ORDER BY sp.spo_id DESC LIMIT $${idx} OFFSET $${idx + 1}`,
    [...p, limit, offset]
  );

  const spoIds = data.rows.map((row) => row.spo_id);
  const qtyMaps = await buildReceivedQtyMapsForSpoIds(spoIds);

  res.json({
    success: true,
    data: data.rows.map((row) => attachSpareProductDetails(row, qtyMaps)),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) || 1 }
  });
}

async function nextNumber(req, res) {
  const num = await nextSparePartsPurchaseOrderNumber();
  res.json({ success: true, purchase_order_number: num });
}

/** Next spare PO number + vendors + brand / part dropdowns (Laravel add_po_parts parity). */
async function formMeta(req, res) {
  try {
    const purchase_order_number = await nextSparePartsPurchaseOrderNumber();

    const vendors = await pool.query(
      `SELECT vendor_id, first_name, business_name, email, phone, address, state
       FROM vendors
       WHERE deleted_at IS NULL AND status = 'approved'
       ORDER BY business_name ASC NULLS LAST, vendor_id DESC
       LIMIT 500`
    );

    let brands = [];
    try {
      const b = await pool.query(
        `SELECT DISTINCT brand FROM laptop_catalog
         WHERE COALESCE(active, TRUE) AND brand IS NOT NULL AND TRIM(brand) != ''
         ORDER BY brand LIMIT 500`
      );
      brands = b.rows.map((row) => row.brand);
    } catch (e) {
      console.warn('[sparePo formMeta] laptop_catalog brands:', e.message || e);
    }

    let parts = [];
    try {
      const pr = await pool.query(
        `SELECT part_id AS id, name FROM vendor_spare_parts_catalog
         WHERE active = TRUE
         ORDER BY name LIMIT 1000`
      );
      parts = pr.rows;
    } catch (e) {
      console.warn('[sparePo formMeta] parts catalog:', e.message || e);
    }

    res.json({
      success: true,
      purchase_order_number,
      brands,
      parts,
      vendors: vendors.rows.map((v) => ({
        id: v.vendor_id,
        label: [v.business_name, v.first_name].filter(Boolean).join(' — ') || `Vendor #${v.vendor_id}`,
        email: v.email,
        phone: v.phone,
        address: v.address,
        state: v.state
      }))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: e.message || 'Failed to load spare PO form meta' });
  }
}

const getValidators = [param('id').isInt().toInt()];

async function getOne(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  const r = await pool.query(
    `SELECT
       sp.*,
       v.first_name AS vendor_first_name,
       v.business_name AS vendor_business_name,
       v.email AS vendor_email,
       v.phone AS vendor_phone,
       v.address AS vendor_address,
       v.state AS vendor_state,
       COALESCE(NULLIF(TRIM(v.business_name), ''), NULLIF(TRIM(v.first_name), ''), '') AS vendor_display_name
     FROM vendor_spare_parts_purchase_orders sp
     LEFT JOIN vendors v ON v.vendor_id = sp.vendor_id AND v.deleted_at IS NULL
     WHERE sp.spo_id = $1 AND sp.deleted_at IS NULL`,
    [req.params.id]
  );
  const qtyMaps = await buildReceivedQtyMapsForSpoIds([Number(req.params.id)]);
  res.json({ success: true, data: attachSpareProductDetails(r.rows[0], qtyMaps) });
}

function createValidators() {
  return [
    body('purchase_order_date').notEmpty(),
    body('vendor_id').isInt().toInt(),
    body('po_state').notEmpty(),
    body('line_items').isArray({ min: 1 })
  ];
}

async function create(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const b = req.body;
  const line_items_raw = Array.isArray(b.line_items) ? b.line_items : [];

  /** Normalize Laravel-style rows: brand/part, warranty_months, quantity, rate */
  const line_items = line_items_raw.map((row) => {
    const qty = Number(row.quantity);
    const rate = Number(row.rate);
    const warranty = Number(row.warranty_months ?? row.warranty ?? row.warranty_in_month ?? 0);
    return {
      ...row,
      brand_id: row.brand_id != null ? Number(row.brand_id) || row.brand_id : null,
      brand_name: row.brand_name != null ? String(row.brand_name) : row.brand != null ? String(row.brand) : '',
      part_id: row.part_id != null ? Number(row.part_id) || row.part_id : null,
      spare_part_name: row.spare_part_name != null ? String(row.spare_part_name) : row.part_name != null ? String(row.part_name) : '',
      warranty_months: Number.isFinite(warranty) ? warranty : 0,
      quantity: Number.isFinite(qty) ? qty : 0,
      rate: Number.isFinite(rate) ? rate : 0,
      receivedQty: 0
    };
  });

  const badIdx = line_items.findIndex((l) => !l.quantity || l.quantity <= 0 || !l.rate || l.rate < 0);
  if (badIdx !== -1) {
    return res.status(400).json({
      success: false,
      message: `Line ${badIdx + 1}: valid quantity and rate are required`
    });
  }

  const vState = await vendorState(b.vendor_id);
  const is_same_state =
    typeof b.is_same_state === 'boolean'
      ? b.is_same_state
      : String(vState || '').toLowerCase() === String(b.po_state || '').toLowerCase();

  const sub_total_amount = b.sub_total_amount ?? lineSubtotal(line_items);
  const total_amount = getTotalAmountOfPurchaseOrder(sub_total_amount, !!is_same_state);

  const purchase_order_number =
    b.purchase_order_number?.trim?.() ||
    (!b.purchase_order_number ? await nextSparePartsPurchaseOrderNumber() : String(b.purchase_order_number));

  try {
    const ins = await pool.query(
      `INSERT INTO vendor_spare_parts_purchase_orders (
        purchase_order_number, purchase_order_date, vendor_id, po_state, is_same_state,
        sub_total_amount, total_amount, line_items, assets_details, remarks, status,
        status_updated_by_admin_id, status_updated_by_name
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [
        purchase_order_number,
        b.purchase_order_date,
        b.vendor_id,
        b.po_state,
        is_same_state,
        sub_total_amount,
        total_amount,
        JSON.stringify(line_items),
        b.assets_details != null ? JSON.stringify(b.assets_details) : null,
        b.remarks || null,
        b.status || 'draft',
        req.user?.user_id || null,
        b.status_updated_by_name || 'Admin'
      ]
    );

    await logVendorAudit({
      actorUserId: req.user?.user_id,
      vendorId: b.vendor_id,
      entityType: 'spare_parts_po',
      entityId: ins.rows[0].spo_id,
      action: 'create',
      payload: { purchase_order_number }
    });

    const qtyMapsNew = await buildReceivedQtyMapsForSpoIds([ins.rows[0].spo_id]);
    res.status(201).json({
      success: true,
      message: 'Spare parts PO saved successfully',
      data: attachSpareProductDetails(ins.rows[0], qtyMapsNew)
    });
  } catch (e) {
    if (String(e.code) === '23505') {
      return res.status(409).json({ success: false, message: 'PO number already exists' });
    }
    console.error(e);
    res.status(500).json({ success: false, message: e.message });
  }
}

const updateValidators = [param('id').isInt().toInt()];

async function update(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  const id = Number(req.params.id);

  const cur = await pool.query(
    `SELECT * FROM vendor_spare_parts_purchase_orders WHERE spo_id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (!cur.rows.length) return res.status(404).json({ success: false, message: 'Not found' });

  const b = req.body;
  const vendor_id = b.vendor_id ?? cur.rows[0].vendor_id;
  const po_state = b.po_state ?? cur.rows[0].po_state;
  const vState = await vendorState(vendor_id);
  let is_same_state = cur.rows[0].is_same_state;
  if (typeof b.is_same_state === 'boolean') is_same_state = b.is_same_state;
  else if (po_state || vState) {
    is_same_state = String(vState || '').toLowerCase() === String(po_state || '').toLowerCase();
  }

  const line_items = Array.isArray(b.line_items) ? b.line_items : parseLineItemsJson(cur.rows[0].line_items);
  const sub_total_amount = b.sub_total_amount ?? lineSubtotal(line_items);
  const total_amount = getTotalAmountOfPurchaseOrder(sub_total_amount, !!is_same_state);

  try {
    const upd = await pool.query(
      `UPDATE vendor_spare_parts_purchase_orders SET
        purchase_order_date = COALESCE($1::date, purchase_order_date),
        vendor_id = COALESCE($2, vendor_id),
        po_state = COALESCE(NULLIF($3,''), po_state),
        is_same_state = $4,
        sub_total_amount = $5,
        total_amount = $6,
        line_items = COALESCE($7::jsonb, line_items),
        assets_details = CASE WHEN $8::jsonb IS NULL THEN assets_details ELSE $8 END,
        remarks = COALESCE($9, remarks),
        status = COALESCE(NULLIF($10,''), status),
        updated_at = NOW()
       WHERE spo_id = $11 RETURNING *`,
      [
        b.purchase_order_date || null,
        b.vendor_id != null ? vendor_id : null,
        po_state || '',
        is_same_state,
        sub_total_amount,
        total_amount,
        b.line_items != null ? JSON.stringify(line_items) : null,
        b.assets_details != null ? JSON.stringify(b.assets_details) : null,
        b.remarks,
        b.status || '',
        id
      ]
    );

    const qtyMaps = await buildReceivedQtyMapsForSpoIds([id]);
    res.json({ success: true, data: attachSpareProductDetails(upd.rows[0], qtyMaps) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: e.message });
  }
}

/* List screen: align with Laravel spare parts view — only pending / draft / empty can change to pending or approved. */
const statusValidators = [param('id').isInt().toInt(), body('status').isIn(['pending', 'approved'])];

async function updateStatus(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const id = Number(req.params.id);
  const { status } = req.body;

  const cur = await pool.query(
    `SELECT status FROM vendor_spare_parts_purchase_orders WHERE spo_id = $1 AND deleted_at IS NULL`,
    [id]
  );
  if (!cur.rows.length) return res.status(404).json({ success: false, message: 'Spare parts PO not found' });

  const prev = String(cur.rows[0].status || '').toLowerCase();
  if (!['pending', 'draft', ''].includes(prev)) {
    return res.status(400).json({
      success: false,
      message: 'Spare parts PO status is locked (only pending or draft can be changed from the list).'
    });
  }

  await pool.query(
    `UPDATE vendor_spare_parts_purchase_orders
     SET status = $1, status_updated_by_admin_id = $2, updated_at = NOW()
     WHERE spo_id = $3 AND deleted_at IS NULL`,
    [status, req.user?.user_id || null, id]
  );

  await logVendorAudit({
    actorUserId: req.user?.user_id,
    vendorId: null,
    entityType: 'spare_parts_po',
    entityId: String(id),
    action: 'status_change',
    payload: { from: prev, to: status }
  });

  res.json({ success: true, message: 'Spare parts PO status updated!', data: { spo_id: id, status } });
}

function createSpoBillsUpload() {
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const dir = path.join(__dirname, '..', '..', 'uploads', 'vendor-spo-bills', String(req.params.id));
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => {
        const safe = String(file.originalname || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${Date.now()}_${safe}`);
      }
    }),
    limits: { fileSize: 25 * 1024 * 1024 }
  });
}

async function uploadBills(req, res) {
  try {
    const id = Number(req.params.id);
    const bill_name = String(req.body.bill_name || '').trim();
    if (!bill_name) return res.status(400).json({ success: false, message: 'Bill number is required' });

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ success: false, message: 'At least one file is required' });

    const cur = await pool.query(
      `SELECT bill_files FROM vendor_spare_parts_purchase_orders WHERE spo_id = $1 AND deleted_at IS NULL`,
      [id]
    );
    if (!cur.rows.length) return res.status(404).json({ success: false, message: 'Spare parts PO not found' });

    let existing = cur.rows[0].bill_files;
    if (existing != null && typeof existing === 'string') {
      try {
        existing = JSON.parse(existing);
      } catch {
        existing = [];
      }
    }
    if (!Array.isArray(existing)) existing = [];

    const newPaths = files.map((f) => `/uploads/vendor-spo-bills/${id}/${f.filename}`);
    const merged = [...existing, ...newPaths];

    await pool.query(
      `UPDATE vendor_spare_parts_purchase_orders SET bill_name = $1, bill_files = $2::jsonb, updated_at = NOW()
       WHERE spo_id = $3 AND deleted_at IS NULL`,
      [bill_name, JSON.stringify(merged), id]
    );

    await logVendorAudit({
      actorUserId: req.user?.user_id,
      vendorId: null,
      entityType: 'spare_parts_po',
      entityId: String(id),
      action: 'bill_upload',
      payload: { bill_name, files_count: files.length }
    });

    res.json({
      success: true,
      message: 'Bill / invoice uploaded successfully.',
      bill_name,
      bill_files: merged
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: e.message || 'Upload failed' });
  }
}

const spareProductReceivedValidators = [param('spoId').isInt().toInt()];

async function getSpareProductReceivedContext(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const spoId = Number(req.params.spoId);
  const r = await pool.query(
    `SELECT
       sp.*,
       v.first_name AS vendor_first_name,
       v.business_name AS vendor_business_name,
       v.email AS vendor_email,
       v.phone AS vendor_phone,
       v.address AS vendor_address,
       v.state AS vendor_state,
       COALESCE(NULLIF(TRIM(v.business_name), ''), NULLIF(TRIM(v.first_name), ''), '') AS vendor_display_name
     FROM vendor_spare_parts_purchase_orders sp
     LEFT JOIN vendors v ON v.vendor_id = sp.vendor_id AND v.deleted_at IS NULL
     WHERE sp.spo_id = $1 AND sp.deleted_at IS NULL`,
    [spoId]
  );
  if (!r.rows.length) return res.status(404).json({ success: false, message: 'Not found' });

  const row = r.rows[0];
  if (!spareReceiveAllowed(row)) {
    return res.status(403).json({
      success: false,
      message: 'Receiving is not available for void or pending spare parts POs.'
    });
  }

  const qtyMaps = await buildReceivedQtyMapsForSpoIds([spoId]);
  const enriched = attachSpareProductDetails(row, qtyMaps);
  const lines = enriched.product_details || [];

  const grnsR = await pool.query(
    `SELECT * FROM vendor_goods_received_notes WHERE spo_id = $1 AND deleted_at IS NULL ORDER BY grn_id`,
    [spoId]
  );

  let orderQty = 0;
  let receivedQty = 0;
  lines.forEach((l) => {
    orderQty += Number(l.quantity) || 0;
    receivedQty += Number(l.receivedQty) || 0;
  });

  res.json({
    success: true,
    data: {
      spare_purchase_order: {
        spo_id: enriched.spo_id,
        purchase_order_number: enriched.purchase_order_number,
        purchase_order_date: enriched.purchase_order_date,
        status: enriched.status,
        remarks: enriched.remarks,
        updated_at: enriched.updated_at,
        vendor_id: enriched.vendor_id,
        vendor_display_name: enriched.vendor_display_name,
        vendor_first_name: enriched.vendor_first_name,
        vendor_business_name: enriched.vendor_business_name,
        vendor_email: enriched.vendor_email,
        vendor_phone: enriched.vendor_phone,
        vendor_address: enriched.vendor_address
      },
      lines,
      stats: {
        total_lines: lines.length,
        order_qty: orderQty,
        received_qty: receivedQty,
        remaining_qty: Math.max(0, orderQty - receivedQty)
      },
      grns: grnsR.rows
    }
  });
}

const receiveSpareSerialValidators = [
  param('spoId').isInt().toInt(),
  body('line_index').isInt({ min: 0 }).toInt(),
  body('serial_number').trim().notEmpty(),
  body('grn_id').optional({ nullable: true }).isInt().toInt()
];

async function receiveSpareLineSerial(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const spoId = Number(req.params.spoId);
  const lineIndex = Number(req.body.line_index);
  const serial_number = String(req.body.serial_number || '').trim();

  let grnId =
    req.body.grn_id === '' || req.body.grn_id === undefined || req.body.grn_id === null
      ? null
      : Number(req.body.grn_id);

  const r = await pool.query(
    `SELECT * FROM vendor_spare_parts_purchase_orders WHERE spo_id = $1 AND deleted_at IS NULL`,
    [spoId]
  );
  if (!r.rows.length) return res.status(404).json({ success: false, message: 'Not found' });
  const spo = r.rows[0];
  if (!spareReceiveAllowed(spo)) {
    return res.status(403).json({
      success: false,
      message: 'Receiving is not available for void or pending spare parts POs.'
    });
  }

  const qtyMaps = await buildReceivedQtyMapsForSpoIds([spoId]);
  const lines = enrichSpareLinesWithReceived(parseLineItemsJson(spo.line_items), qtyMaps.get(spoId));
  const line = lines[lineIndex];
  if (!line) {
    return res.status(400).json({ success: false, message: 'Invalid line_index for this spare PO' });
  }

  const ordered = Number(line.quantity) || 0;
  const currentReceived = Number(line.receivedQty) || 0;
  if (currentReceived + 1 > ordered) {
    return res.status(400).json({
      success: false,
      message: 'Cannot receive more units than ordered for this line.'
    });
  }

  const pd = line.product_detail_id ?? line.part_id ?? line.product_id ?? line.pro_id ?? line.id;
  const extra = { line_index: lineIndex };
  if (pd != null && String(pd).trim() !== '') extra.part_id = String(pd);

  const client = await pool.connect();
  let finalGrnId;
  let serialId;
  try {
    await client.query('BEGIN');

    if (grnId != null && Number.isFinite(grnId)) {
      const g = await client.query(
        `SELECT grn_id FROM vendor_goods_received_notes WHERE grn_id = $1 AND spo_id = $2 AND deleted_at IS NULL`,
        [grnId, spoId]
      );
      if (!g.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Invalid GRN for this spare PO.' });
      }
      finalGrnId = grnId;
    } else {
      const last = await client.query(
        `SELECT grn_id FROM vendor_goods_received_notes WHERE spo_id = $1 AND deleted_at IS NULL ORDER BY grn_id DESC LIMIT 1`,
        [spoId]
      );
      if (last.rows.length) finalGrnId = last.rows[0].grn_id;
      else {
        const insG = await client.query(
          `INSERT INTO vendor_goods_received_notes (spo_id, meta) VALUES ($1, '{}'::jsonb) RETURNING grn_id`,
          [spoId]
        );
        finalGrnId = insG.rows[0].grn_id;
      }
    }

    const insS = await client.query(
      `INSERT INTO vendor_serial_numbers (spo_id, grn_id, serial_number, extra)
       VALUES ($1,$2,$3,$4::jsonb) RETURNING serial_id`,
      [spoId, finalGrnId, serial_number, JSON.stringify(extra)]
    );
    serialId = insS.rows[0].serial_id;

    await client.query('COMMIT');
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    if (String(e.code) === '23505') {
      return res.status(409).json({ success: false, message: 'Serial number already exists' });
    }
    console.error(e);
    return res.status(500).json({ success: false, message: e.message });
  } finally {
    client.release();
  }

  await logVendorAudit({
    actorUserId: req.user?.user_id,
    vendorId: spo.vendor_id || null,
    entityType: 'serial_number',
    entityId: String(serialId),
    action: 'receive_on_spare_po_line',
    payload: { spo_id: spoId, grn_id: finalGrnId, line_index: lineIndex }
  });

  const qtyMaps2 = await buildReceivedQtyMapsForSpoIds([spoId]);
  const lines2 = enrichSpareLinesWithReceived(parseLineItemsJson(spo.line_items), qtyMaps2.get(spoId));

  res.status(201).json({
    success: true,
    message: 'Serial recorded against this spare PO line.',
    data: { grn_id: finalGrnId, serial_id: serialId, lines: lines2 }
  });
}

/** Multi-unit spare receive — manual serials per row + global TTSPL sequence (migration 036). */
const RECEIVE_SPARE_BULK_CAP = 250;

const receiveSpareLineBulkValidators = [
  param('spoId').isInt().toInt(),
  body('line_index').isInt({ min: 0 }).toInt(),
  body('quantity').isInt({ min: 1, max: RECEIVE_SPARE_BULK_CAP }).toInt(),
  body('serial_numbers').isArray({ min: 1 }).withMessage('serial_numbers required'),
  body('serial_numbers.*').trim().notEmpty(),
  body('grn_id').optional({ nullable: true }).isInt().toInt(),
  body().custom((_v, { req }) => {
    const q = Number(req.body.quantity);
    const arr = req.body.serial_numbers;
    if (!Array.isArray(arr) || arr.length !== q) {
      throw new Error('serial_numbers must contain exactly quantity entries');
    }
    const norm = arr.map((s) => String(s || '').trim().toUpperCase());
    const set = new Set(norm);
    if (set.size !== norm.length) {
      throw new Error('Duplicate serial numbers in this submission');
    }
    return true;
  })
];

async function receiveSpareLineBulk(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const spoId = Number(req.params.spoId);
  const lineIndex = Number(req.body.line_index);
  const quantity = Number(req.body.quantity);

  let grnId =
    req.body.grn_id === '' || req.body.grn_id === undefined || req.body.grn_id === null
      ? null
      : Number(req.body.grn_id);

  const serialsNorm = req.body.serial_numbers.map((s) => String(s || '').trim().toUpperCase());

  const r = await pool.query(
    `SELECT * FROM vendor_spare_parts_purchase_orders WHERE spo_id = $1 AND deleted_at IS NULL`,
    [spoId]
  );
  if (!r.rows.length) return res.status(404).json({ success: false, message: 'Not found' });
  const spo = r.rows[0];
  if (!spareReceiveAllowed(spo)) {
    return res.status(403).json({
      success: false,
      message: 'Receiving is not available for void or pending spare parts POs.'
    });
  }

  const qtyMapsBefore = await buildReceivedQtyMapsForSpoIds([spoId]);
  const linesBefore = enrichSpareLinesWithReceived(parseLineItemsJson(spo.line_items), qtyMapsBefore.get(spoId));
  const line = linesBefore[lineIndex];
  if (!line) {
    return res.status(400).json({ success: false, message: 'Invalid line_index for this spare PO' });
  }

  const ordered = Number(line.quantity) || 0;
  const currentReceived = Number(line.receivedQty) || 0;
  const remaining = Math.max(0, ordered - currentReceived);
  if (quantity > remaining) {
    return res.status(400).json({
      success: false,
      message: `Cannot receive ${quantity} units; only ${remaining} remaining on this line.`
    });
  }

  const pd = line.product_detail_id ?? line.part_id ?? line.product_id ?? line.pro_id ?? line.id;

  const client = await pool.connect();
  let finalGrnId;
  const createdRows = [];

  try {
    await client.query('BEGIN');

    const dup = await client.query(
      `SELECT serial_number FROM vendor_serial_numbers
       WHERE deleted_at IS NULL AND LOWER(serial_number) = ANY($1::text[])`,
      [serialsNorm.map((s) => s.toLowerCase())]
    );
    if (dup.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        message: `Serial already exists in inventory: ${dup.rows.map((row) => row.serial_number).join(', ')}`
      });
    }

    if (grnId != null && Number.isFinite(grnId)) {
      const g = await client.query(
        `SELECT grn_id FROM vendor_goods_received_notes WHERE grn_id = $1 AND spo_id = $2 AND deleted_at IS NULL`,
        [grnId, spoId]
      );
      if (!g.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Invalid GRN for this spare PO.' });
      }
      finalGrnId = grnId;
    } else {
      const last = await client.query(
        `SELECT grn_id FROM vendor_goods_received_notes WHERE spo_id = $1 AND deleted_at IS NULL ORDER BY grn_id DESC LIMIT 1`,
        [spoId]
      );
      if (last.rows.length) finalGrnId = last.rows[0].grn_id;
      else {
        const insG = await client.query(
          `INSERT INTO vendor_goods_received_notes (spo_id, meta) VALUES ($1, '{}'::jsonb) RETURNING grn_id`,
          [spoId]
        );
        finalGrnId = insG.rows[0].grn_id;
      }
    }

    const assetCodes = await allocateTtsplCodes(client, quantity);

    for (let i = 0; i < quantity; i += 1) {
      const serial_number = serialsNorm[i];
      const inventory_asset_code = assetCodes[i];
      const extra = {
        line_index: lineIndex,
        unique_product_serial: inventory_asset_code
      };
      if (pd != null && String(pd).trim() !== '') extra.part_id = String(pd);

      const insS = await client.query(
        `INSERT INTO vendor_serial_numbers (spo_id, grn_id, serial_number, inventory_asset_code, rental_start_date, extra)
         VALUES ($1,$2,$3,$4,NULL,$5::jsonb) RETURNING serial_id`,
        [spoId, finalGrnId, serial_number, inventory_asset_code, JSON.stringify(extra)]
      );
      createdRows.push({
        serial_id: insS.rows[0].serial_id,
        serial_number,
        inventory_asset_code
      });
    }

    await client.query('COMMIT');
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    if (String(e.code) === '23505') {
      return res.status(409).json({ success: false, message: 'Serial number or inventory code already exists' });
    }
    console.error(e);
    return res.status(500).json({ success: false, message: e.message || 'Spare bulk receive failed' });
  } finally {
    client.release();
  }

  await logVendorAudit({
    actorUserId: req.user?.user_id,
    vendorId: spo.vendor_id || null,
    entityType: 'serial_number_bulk',
    entityId: String(spoId),
    action: 'receive_bulk_on_spare_po_line',
    payload: {
      spo_id: spoId,
      grn_id: finalGrnId,
      line_index: lineIndex,
      qty: quantity,
      inventory_codes: createdRows.map((x) => x.inventory_asset_code)
    }
  });

  const qtyMapsAfter = await buildReceivedQtyMapsForSpoIds([spoId]);
  const linesAfter = enrichSpareLinesWithReceived(parseLineItemsJson(spo.line_items), qtyMapsAfter.get(spoId));

  res.status(201).json({
    success: true,
    message: `${quantity} spare unit(s) received with asset codes.`,
    data: {
      grn_id: finalGrnId,
      created: createdRows,
      lines: linesAfter
    }
  });
}

const spareGrnPoParam = [param('spoId').isInt().toInt()];
const spareGrnCreateValidators = [body('meta').optional().isObject()];

async function createSpareGrn(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const spoId = Number(req.params.spoId);
  const meta = req.body?.meta && typeof req.body.meta === 'object' ? req.body.meta : {};

  const spo = await pool.query(`SELECT 1 FROM vendor_spare_parts_purchase_orders WHERE spo_id = $1 AND deleted_at IS NULL`, [
    spoId
  ]);
  if (!spo.rows.length) return res.status(404).json({ success: false, message: 'Spare PO not found' });

  const ins = await pool.query(
    `INSERT INTO vendor_goods_received_notes (spo_id, meta) VALUES ($1, $2::jsonb) RETURNING *`,
    [spoId, JSON.stringify(meta)]
  );

  await logVendorAudit({
    actorUserId: req.user?.user_id,
    vendorId: null,
    entityType: 'grn',
    entityId: ins.rows[0].grn_id,
    action: 'create',
    payload: { spo_id: spoId }
  });

  res.status(201).json({ success: true, data: ins.rows[0] });
}

const spareGeneratedGrnValidators = [param('spoId').isInt().toInt()];

async function getSpareGeneratedGrnOverview(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const spoId = Number(req.params.spoId);
  const r = await pool.query(
    `SELECT
       sp.*,
       v.first_name AS vendor_first_name,
       v.business_name AS vendor_business_name,
       v.email AS vendor_email,
       v.phone AS vendor_phone,
       v.address AS vendor_address,
       v.state AS vendor_state,
       COALESCE(NULLIF(TRIM(v.business_name), ''), NULLIF(TRIM(v.first_name), ''), '') AS vendor_display_name
     FROM vendor_spare_parts_purchase_orders sp
     LEFT JOIN vendors v ON v.vendor_id = sp.vendor_id AND v.deleted_at IS NULL
     WHERE sp.spo_id = $1 AND sp.deleted_at IS NULL`,
    [spoId]
  );
  if (!r.rows.length) return res.status(404).json({ success: false, message: 'Not found' });

  const row = r.rows[0];
  const qtyMaps = await buildReceivedQtyMapsForSpoIds([spoId]);
  const enriched = attachSpareProductDetails(row, qtyMaps);
  const lines = enriched.product_details || [];

  let orderQty = 0;
  let receivedQty = 0;
  lines.forEach((l) => {
    orderQty += Number(l.quantity) || 0;
    receivedQty += Number(l.receivedQty) || 0;
  });

  const grnRows = await pool.query(
    `
    SELECT
      g.grn_id,
      g.created_at,
      g.updated_at,
      COUNT(s.serial_id)::int AS received_qty,
      ('GRN-' || LPAD(g.grn_id::text, 4, '0')) AS grn_number
    FROM vendor_goods_received_notes g
    LEFT JOIN vendor_serial_numbers s
      ON s.grn_id = g.grn_id AND s.spo_id = g.spo_id AND s.deleted_at IS NULL
    WHERE g.spo_id = $1 AND g.deleted_at IS NULL
    GROUP BY g.grn_id, g.created_at, g.updated_at
    ORDER BY g.grn_id DESC
    `,
    [spoId]
  );

  res.json({
    success: true,
    data: {
      purchase_order: {
        spo_id: enriched.spo_id,
        purchase_order_number: enriched.purchase_order_number,
        purchase_order_type: null,
        purchase_order_date: enriched.purchase_order_date,
        status: enriched.status,
        remarks: enriched.remarks,
        updated_at: enriched.updated_at,
        vendor_id: enriched.vendor_id,
        vendor_display_name: enriched.vendor_display_name,
        vendor_first_name: enriched.vendor_first_name,
        vendor_business_name: enriched.vendor_business_name,
        vendor_email: enriched.vendor_email,
        vendor_phone: enriched.vendor_phone,
        vendor_address: enriched.vendor_address
      },
      lines,
      stats: {
        total_lines: lines.length,
        order_qty: orderQty,
        received_qty: receivedQty,
        remaining_qty: Math.max(0, orderQty - receivedQty)
      },
      grn_rows: grnRows.rows
    }
  });
}

const spareGrnReceivedProductsValidators = [param('spoId').isInt().toInt(), param('grnId').isInt().toInt()];

async function getSpareGrnReceivedProducts(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const spoId = Number(req.params.spoId);
  const grnId = Number(req.params.grnId);

  const g = await pool.query(
    `SELECT * FROM vendor_goods_received_notes WHERE grn_id = $1 AND spo_id = $2 AND deleted_at IS NULL`,
    [grnId, spoId]
  );
  if (!g.rows.length) {
    return res.status(404).json({ success: false, message: 'GRN not found for this spare PO' });
  }

  const spoR = await pool.query(`SELECT line_items FROM vendor_spare_parts_purchase_orders WHERE spo_id = $1 AND deleted_at IS NULL`, [
    spoId
  ]);
  const lineItems = parseLineItemsJson(spoR.rows[0]?.line_items);

  const serials = await pool.query(
    `SELECT serial_id, serial_number, inventory_asset_code, extra, created_at FROM vendor_serial_numbers
     WHERE spo_id = $1 AND grn_id = $2 AND deleted_at IS NULL
     ORDER BY serial_id`,
    [spoId, grnId]
  );

  const grn = g.rows[0];
  const items = serials.rows.map((s) => {
    const ex = s.extra && typeof s.extra === 'object' && s.extra !== null && !Array.isArray(s.extra) ? s.extra : {};
    const li = Number(ex.line_index);
    const line = Number.isFinite(li) && li >= 0 && lineItems[li] ? lineItems[li] : {};
    const rep = ex.is_replaced === true || ex.is_replaced === 1 || String(ex.is_replaced) === '1';
    const repa = ex.is_repaired === true || ex.is_repaired === 1 || String(ex.is_repaired) === '1';
    return {
      serial_id: s.serial_id,
      serial_number: s.serial_number,
      inventory_asset_code: s.inventory_asset_code ?? null,
      unique_product_serial: ex.unique_product_serial ?? ex.unique_number ?? s.inventory_asset_code ?? null,
      is_replaced: rep ? 1 : 0,
      is_repaired: repa ? 1 : 0,
      brand: line.brand_name ?? line.brand ?? null,
      model: line.spare_part_name ?? line.part_name ?? line.name ?? null,
      processor: null,
      generation: null,
      ram: null,
      storage: null,
      gpu: null,
      screen_size: null,
      grn_date: grn.updated_at ?? grn.created_at
    };
  });

  res.json({
    success: true,
    data: {
      grn_id: grnId,
      grn_number: formatGrnNumber(grnId),
      created_at: grn.created_at,
      updated_at: grn.updated_at,
      items
    }
  });
}

async function remove(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  await pool.query(`UPDATE vendor_spare_parts_purchase_orders SET deleted_at = NOW() WHERE spo_id = $1 AND deleted_at IS NULL`, [
    req.params.id
  ]);
  res.json({ success: true });
}


module.exports = {
  listValidators,
  list,
  nextNumber,
  formMeta,
  spareProductReceivedValidators,
  getSpareProductReceivedContext,
  receiveSpareSerialValidators,
  receiveSpareLineSerial,
  receiveSpareLineBulkValidators,
  receiveSpareLineBulk,
  spareGrnPoParam,
  spareGrnCreateValidators,
  createSpareGrn,
  spareGeneratedGrnValidators,
  getSpareGeneratedGrnOverview,
  spareGrnReceivedProductsValidators,
  getSpareGrnReceivedProducts,
  getValidators,
  getOne,
  createValidators,
  create,
  updateValidators,
  update,
  statusValidators,
  updateStatus,
  createSpoBillsUpload,
  uploadBills,
  remove
};
