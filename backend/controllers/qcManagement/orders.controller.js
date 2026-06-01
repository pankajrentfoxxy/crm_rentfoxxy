const { param, body, query, validationResult } = require('express-validator');
const pool = require('../../config/db');
const {
  EFFECTIVE_STATUS_SQL,
  enrichSerialRow,
  normalizeRouteStatus,
  parseExtra,
  resolveLineItem
} = require('../../services/qcManagementService');

const listValidators = [
  param('status').isString().trim(),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 500 }).toInt(),
  query('search').optional().isString().trim()
];

async function listOrdersByStatus(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const status = normalizeRouteStatus(req.params.status);
  if (!status) {
    return res.status(400).json({ success: false, message: 'Invalid QC status' });
  }

  const page = req.query.page || 1;
  const limit = req.query.limit || 50;
  const offset = (page - 1) * limit;
  const search = (req.query.search || '').trim();

  const params = [status];
  let searchSql = '';
  if (search) {
    params.push(`%${search}%`);
    const i = params.length;
    searchSql = ` AND (
      s.serial_number ILIKE $${i}
      OR COALESCE(s.inventory_asset_code, '') ILIKE $${i}
      OR p.purchase_order_number ILIKE $${i}
      OR COALESCE(v.business_name, '') ILIKE $${i}
      OR s.extra::text ILIKE $${i}
    )`;
  }

  const fromSql = `
    FROM vendor_serial_numbers s
    INNER JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
    LEFT JOIN vendors v ON v.vendor_id = p.vendor_id AND v.deleted_at IS NULL
    WHERE s.deleted_at IS NULL
      AND s.po_id IS NOT NULL
      AND ${EFFECTIVE_STATUS_SQL} = $1
      ${searchSql}
  `;

  try {
    const countR = await pool.query(`SELECT COUNT(*)::int AS total ${fromSql}`, params);
    const total = countR.rows[0]?.total || 0;

    const listParams = [...params, limit, offset];
    const rowsR = await pool.query(
      `SELECT
         s.serial_id,
         s.serial_number,
         s.inventory_asset_code,
         s.qc_status,
         s.remark,
         s.extra,
         s.created_at AS serial_created_at,
         s.updated_at AS serial_updated_at,
         s.rental_start_date,
         s.grn_id,
         p.po_id,
         p.purchase_order_number,
         p.purchase_order_type,
         p.purchase_order_date,
         p.vendor_id,
         p.line_items,
         v.business_name,
         v.contact_name AS vendor_name
       ${fromSql}
       ORDER BY s.updated_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    const data = rowsR.rows.map(enrichSerialRow);
    res.json({
      success: true,
      status,
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit))
      }
    });
  } catch (e) {
    console.error('listOrdersByStatus', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to load QC orders' });
  }
}

async function getStatusCounts(req, res) {
  try {
    const r = await pool.query(
      `SELECT ${EFFECTIVE_STATUS_SQL} AS status, COUNT(*)::int AS count
       FROM vendor_serial_numbers s
       WHERE s.deleted_at IS NULL AND s.po_id IS NOT NULL
       GROUP BY 1`
    );
    const counts = {
      pending: 0,
      passed: 0,
      failed: 0,
      dead: 0,
      require_for_parts: 0
    };
    for (const row of r.rows) {
      if (Object.prototype.hasOwnProperty.call(counts, row.status)) {
        counts[row.status] = row.count;
      }
    }
    res.json({ success: true, counts });
  } catch (e) {
    console.error('getStatusCounts', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to load counts' });
  }
}

const pendingPoValidators = [
  param('poId').isInt({ min: 1 }).toInt(),
  param('status').optional().isString().trim()
];

/** Laravel qcPendingOrders — products on a PO still in pending QC */
async function listPendingProductsByPo(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const poId = req.params.poId;
  const status = normalizeRouteStatus(req.params.status || 'processing') || 'pending';

  try {
    const r = await pool.query(
      `SELECT
         s.serial_id,
         s.serial_number,
         s.extra,
         s.qc_status,
         p.po_id,
         p.purchase_order_number,
         p.vendor_id,
         p.line_items
       FROM vendor_serial_numbers s
       INNER JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
       WHERE s.deleted_at IS NULL
         AND s.po_id = $1
         AND ${EFFECTIVE_STATUS_SQL} = $2
       ORDER BY s.updated_at DESC`,
      [poId, status]
    );

    const byProduct = new Map();
    for (const row of r.rows) {
      const line = resolveLineItem(row.line_items, row.extra);
      const proId =
        line?.product_detail_id ?? line?.product_id ?? parseExtra(row.extra).product_detail_id ?? 'unknown';
      const key = String(proId);
      if (!byProduct.has(key)) {
        byProduct.set(key, {
          po_id: row.po_id,
          pro_id: proId,
          vendor_id: row.vendor_id,
          purchase_order_number: row.purchase_order_number,
          model: line?.product_name ?? line?.model ?? '—',
          serial_count: 0
        });
      }
      byProduct.get(key).serial_count += 1;
    }

    res.json({ success: true, data: Array.from(byProduct.values()) });
  } catch (e) {
    console.error('listPendingProductsByPo', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to load PO products' });
  }
}

const orderDetailsValidators = [
  body('po_id').isInt({ min: 1 }).toInt(),
  body('pro_id').notEmpty(),
  body('status').optional().isString().trim()
];

/** Laravel getOrderDetails */
async function getOrderDetails(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const poId = req.body.po_id;
  const proId = String(req.body.pro_id);
  const status = normalizeRouteStatus(req.body.status || 'processing') || 'pending';

  try {
    const r = await pool.query(
      `SELECT
         s.serial_id AS serial_numbers_id,
         s.serial_number,
         s.inventory_asset_code,
         s.qc_status,
         s.remark AS serial_numbers_remark,
         s.extra,
         s.created_at,
         s.updated_at,
         p.*,
         g.grn_id,
         g.meta AS grn_meta
       FROM vendor_serial_numbers s
       INNER JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
       LEFT JOIN vendor_goods_received_notes g ON g.grn_id = s.grn_id AND g.deleted_at IS NULL
       WHERE s.deleted_at IS NULL
         AND s.po_id = $1
         AND ${EFFECTIVE_STATUS_SQL} = $2`,
      [poId, status]
    );

    const filtered = r.rows.filter((row) => {
      const line = resolveLineItem(row.line_items, row.extra);
      const id = line?.product_detail_id ?? line?.product_id ?? parseExtra(row.extra).product_detail_id;
      return id != null && String(id) === proId;
    });

    res.json({ success: true, data: filtered });
  } catch (e) {
    console.error('getOrderDetails', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to load order details' });
  }
}

const qcCheckValidators = [
  body('serial_number_id').isInt({ min: 1 }).toInt(),
  body('serial_number').notEmpty().trim(),
  body('selected_value').isIn([
    'pending',
    'passed',
    'failed',
    'require_for_parts',
    'send_to_qc_check'
  ]),
  body('remark').optional().isString(),
  body('sparePartsIds').optional()
];

/** Laravel qcCheck — updates qc_status / remark / extra */
async function qcCheck(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const serialId = req.body.serial_number_id;
  const serialNumber = String(req.body.serial_number).trim();
  const selected = req.body.selected_value;
  const remark = req.body.remark ?? '';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT serial_id, extra, qc_status FROM vendor_serial_numbers
       WHERE serial_id = $1 AND serial_number = $2 AND deleted_at IS NULL
       FOR UPDATE`,
      [serialId, serialNumber]
    );
    if (!cur.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Serial not found' });
    }

    const extra = parseExtra(cur.rows[0].extra);
    let qcStatus = selected;
    let inventoryStatus = extra.status2 ?? null;

    if (selected === 'require_for_parts') {
      extra.status2 = 'require_for_parts';
      extra.require_parts = req.body.sparePartsIds ?? '';
      inventoryStatus = 'require_for_parts';
    } else if (selected === 'send_to_qc_check') {
      qcStatus = 'pending';
      extra.status2 = 'send_to_qc_check';
    } else if (selected === 'failed') {
      /* parity with Laravel repair log hook — stored in extra for now */
      extra.repair_start_date = new Date().toISOString().slice(0, 10);
      extra.repair_type = 'failed';
    }

    await client.query(
      `UPDATE vendor_serial_numbers
       SET qc_status = $1,
           remark = $2,
           inventory_status = COALESCE($3, inventory_status),
           extra = $4::jsonb,
           updated_at = NOW()
       WHERE serial_id = $5`,
      [qcStatus, remark, inventoryStatus, JSON.stringify(extra), serialId]
    );

    await client.query('COMMIT');
    res.json({ success: true, message: 'QC check updated successfully' });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    console.error('qcCheck', e);
    res.status(500).json({ success: false, message: e.message || 'QC check failed' });
  } finally {
    client.release();
  }
}

const hardwareQcValidators = [
  body('serial_number_id').isInt({ min: 1 }).toInt(),
  body('serial_number').notEmpty().trim(),
  body('selected_value').notEmpty().trim(),
  body('remark').optional().isString(),
  body('sparePartsIds').optional()
];

/** Laravel hardwareQcCheck */
async function hardwareQcCheck(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const serialId = req.body.serial_number_id;
  const serialNumber = String(req.body.serial_number).trim();

  try {
    const cur = await pool.query(
      `SELECT extra FROM vendor_serial_numbers
       WHERE serial_id = $1 AND serial_number = $2 AND deleted_at IS NULL`,
      [serialId, serialNumber]
    );
    if (!cur.rows.length) {
      return res.status(404).json({ success: false, message: 'Serial not found' });
    }

    const extra = parseExtra(cur.rows[0].extra);
    extra.hardware_action = req.body.selected_value;
    extra.hardware_remark = req.body.remark ?? '';
    extra.hardware_action_by = req.user?.user_id ?? null;
    extra.hardware_action_date = new Date().toISOString();

    if (req.body.selected_value === 'require_for_parts') {
      extra.require_parts = req.body.sparePartsIds ?? '';
      await pool.query(
        `UPDATE vendor_serial_numbers
         SET qc_status = 'require_for_parts',
             inventory_status = 'require_for_parts',
             extra = $1::jsonb,
             updated_at = NOW()
         WHERE serial_id = $2`,
        [JSON.stringify(extra), serialId]
      );
    } else {
      await pool.query(
        `UPDATE vendor_serial_numbers SET extra = $1::jsonb, updated_at = NOW() WHERE serial_id = $2`,
        [JSON.stringify(extra), serialId]
      );
    }

    res.json({ success: true, message: 'Hardware QC updated successfully' });
  } catch (e) {
    console.error('hardwareQcCheck', e);
    res.status(500).json({ success: false, message: e.message || 'Hardware QC failed' });
  }
}

module.exports = {
  listValidators,
  listOrdersByStatus,
  getStatusCounts,
  pendingPoValidators,
  listPendingProductsByPo,
  orderDetailsValidators,
  getOrderDetails,
  qcCheckValidators,
  qcCheck,
  hardwareQcValidators,
  hardwareQcCheck
};
