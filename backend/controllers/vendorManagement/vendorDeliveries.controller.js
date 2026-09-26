/**
 * Procure to stock, step 5 — vendor deliveries (D4, D5, D7).
 *
 * The guard logs a vendor's delivery at the gate: which PO, the vendor's
 * challan (and invoice if it came with the laptops), how many laptops. The
 * warehouse then receives against that entry (receive-unit with delivery_id),
 * which gives the delivery its own GRN and stops at the count the guard
 * logged. Closing the delivery records any difference between what arrived
 * and what was received.
 */
const { body, param, query, validationResult } = require('express-validator');
const pool = require('../../config/db');
const { logVendorAudit } = require('../../services/vendorAuditLogService');
const po = require('./purchaseOrders.controller');

const RECEIVABLE = ['approved', 'sent', 'vendor_accepted', 'processing'];
const isManager = (u) => u?.is_superadmin === true || ['manager', 'admin', 'super_admin'].includes(String(u?.role || '').toLowerCase());
const bad = (res, errors) => res.status(400).json({ success: false, message: errors.array()[0].msg, errors: errors.array() });

const DELIVERY_SELECT = `
  SELECT d.*, p.purchase_order_number, p.purchase_order_type, p.status AS po_status,
         COALESCE(NULLIF(TRIM(v.business_name), ''), v.first_name) AS vendor_name,
         lu.name AS logged_by_name, cu.name AS completed_by_name,
         COALESCE(u.received, 0)::int AS received_count,
         COALESCE(u.rejected, 0)::int AS rejected_count,
         COALESCE(u.waiver_pending, 0)::int AS waiver_pending_count
    FROM vendor_deliveries d
    JOIN vendor_purchase_orders p ON p.po_id = d.po_id
    LEFT JOIN vendors v ON v.vendor_id = d.vendor_id
    LEFT JOIN users lu ON lu.user_id = d.logged_by
    LEFT JOIN users cu ON cu.user_id = d.completed_by
    LEFT JOIN LATERAL (
      SELECT COUNT(*) FILTER (WHERE NOT s.rejected_at_receipt) AS received,
             COUNT(*) FILTER (WHERE s.rejected_at_receipt) AS rejected,
             COUNT(*) FILTER (WHERE s.config_capture_waived AND s.waiver_approved_at IS NULL) AS waiver_pending
        FROM vendor_serial_numbers s
       WHERE d.grn_id IS NOT NULL AND s.grn_id = d.grn_id AND s.deleted_at IS NULL
    ) u ON TRUE`;

/** GET /deliveries/expected — POs the gate can expect laptops for. */
async function expected(req, res) {
  const r = await pool.query(
    `SELECT p.po_id, p.purchase_order_number, p.purchase_order_type, p.status, p.expected_delivery_date, p.line_items,
            COALESCE(NULLIF(TRIM(v.business_name), ''), v.first_name) AS vendor_name, v.phone AS vendor_phone
       FROM vendor_purchase_orders p LEFT JOIN vendors v ON v.vendor_id = p.vendor_id
      WHERE p.deleted_at IS NULL AND LOWER(COALESCE(p.status, '')) = ANY($1::text[])
      ORDER BY p.expected_delivery_date ASC NULLS LAST, p.po_id DESC`,
    [RECEIVABLE]
  );
  const maps = await po.buildReceivedQtyMapsForPoIds(r.rows.map((x) => x.po_id));
  const data = r.rows.map((x) => {
    const lines = po.enrichLineItemsWithReceived(po.parseLineItemsJson(x.line_items), maps.get(Number(x.po_id)));
    const ordered = lines.reduce((n, l) => n + (Number(l.quantity) || 0), 0);
    const received = lines.reduce((n, l) => n + (Number(l.receivedQty) || 0), 0);
    const { line_items: _omit, ...rest } = x;
    return { ...rest, ordered, received, remaining: Math.max(0, ordered - received) };
  }).filter((x) => x.remaining > 0);
  res.json({ success: true, data });
}

const listValidators = [
  query('status').optional().isString().trim(),
  query('po_id').optional().isInt().toInt(),
  query('limit').optional().isInt({ min: 1, max: 200 }).toInt(),
];
/** GET /deliveries — the arrival queue (default: not yet closed). */
async function list(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return bad(res, errors);
  const allowed = new Set(['arrived', 'receiving', 'received', 'cancelled']);
  const statuses = String(req.query.status || 'arrived,receiving').split(',').map((x) => x.trim()).filter((x) => allowed.has(x));
  const params = [statuses.length ? statuses : ['arrived', 'receiving']];
  let where = 'd.status = ANY($1::text[])';
  if (req.query.po_id) { params.push(req.query.po_id); where += ` AND d.po_id = $${params.length}`; }
  params.push(req.query.limit || 100);
  const r = await pool.query(`${DELIVERY_SELECT} WHERE ${where} ORDER BY d.arrived_at DESC LIMIT $${params.length}`, params);
  const counts = await pool.query('SELECT status, COUNT(*)::int AS n FROM vendor_deliveries GROUP BY 1');
  res.json({ success: true, data: r.rows, counts: Object.fromEntries(counts.rows.map((c) => [c.status, c.n])) });
}

const createValidators = [
  body('po_id').isInt().toInt(),
  body('laptop_count').isInt({ min: 1, max: 1000 }).toInt().withMessage('Count the laptops that arrived'),
  body('vendor_challan_no').isString().trim().isLength({ min: 1, max: 100 }).withMessage("Enter the vendor's challan or delivery note number"),
  body('vendor_invoice_no').optional({ nullable: true }).isString().trim().isLength({ max: 100 }),
  body('carrier_name').optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
  body('vehicle_no').optional({ nullable: true }).isString().trim().isLength({ max: 50 }),
  body('notes').optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
];
/** POST /deliveries — the guard logs a vendor delivery at the gate. */
async function create(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return bad(res, errors);
  const p = (await pool.query(
    'SELECT po_id, vendor_id, status, purchase_order_number FROM vendor_purchase_orders WHERE po_id = $1 AND deleted_at IS NULL',
    [req.body.po_id]
  )).rows[0];
  if (!p) return res.status(404).json({ success: false, message: 'Purchase order not found' });
  if (!RECEIVABLE.includes(String(p.status || '').toLowerCase())) {
    return res.status(409).json({ success: false, message: `${p.purchase_order_number} is ${p.status}: laptops can't be received on it. Call procurement before letting the delivery in.` });
  }
  const client = await pool.connect();
  let row;
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO vendor_deliveries (po_id, vendor_id, vendor_challan_no, vendor_invoice_no, laptop_count, carrier_name, vehicle_no, notes, logged_by)
       VALUES ($1, $2, $3, NULLIF($4, ''), $5, NULLIF($6, ''), NULLIF($7, ''), NULLIF($8, ''), $9) RETURNING delivery_id`,
      [p.po_id, p.vendor_id, req.body.vendor_challan_no, req.body.vendor_invoice_no || '', req.body.laptop_count,
        req.body.carrier_name || '', req.body.vehicle_no || '', req.body.notes || '', req.user?.user_id || null]
    );
    const id = ins.rows[0].delivery_id;
    row = (await client.query(
      "UPDATE vendor_deliveries SET delivery_number = 'VD-' || LPAD($1::text, 6, '0') WHERE delivery_id = $1 RETURNING *",
      [id]
    )).rows[0];
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('vendor delivery create:', e);
    return res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    client.release();
  }
  await logVendorAudit({
    actorUserId: req.user?.user_id, vendorId: p.vendor_id, entityType: 'vendor_delivery', entityId: String(row.delivery_id),
    action: 'arrived', payload: { po_id: p.po_id, laptop_count: row.laptop_count, vendor_challan_no: row.vendor_challan_no },
  });
  res.status(201).json({ success: true, data: row, message: `${row.delivery_number} logged — ${row.laptop_count} laptop(s) for ${p.purchase_order_number}` });
}

/** GET /deliveries/:id — the delivery with its PO lines and every unit received on it. */
async function getOne(req, res) {
  const id = Number(req.params.id);
  const d = (await pool.query(`${DELIVERY_SELECT} WHERE d.delivery_id = $1`, [id])).rows[0];
  if (!d) return res.status(404).json({ success: false, message: 'Delivery not found' });
  const p = (await pool.query('SELECT line_items FROM vendor_purchase_orders WHERE po_id = $1', [d.po_id])).rows[0];
  const maps = await po.buildReceivedQtyMapsForPoIds([d.po_id]);
  const lines = po.enrichLineItemsWithReceived(po.parseLineItemsJson(p?.line_items), maps.get(Number(d.po_id)));
  const units = d.grn_id ? (await pool.query(
    `SELECT s.serial_id, s.serial_number, s.inventory_asset_code AS ttspl_id, s.inventory_status, s.received_condition,
            s.missing_parts, s.capture_token_id, s.config_capture_waived, s.config_capture_waiver_reason,
            s.waiver_approved_at, au.name AS waiver_approved_by_name,
            s.rejected_at_receipt, s.receipt_rejection_reason, s.created_at,
            COALESCE(NULLIF(s.extra->>'line_index', '')::int, 0) AS line_index,
            s.extra->>'brand' AS brand, COALESCE(s.extra->>'model', s.extra->>'model_name') AS model,
            s.extra->>'processor' AS processor, s.extra->>'generation' AS generation, s.extra->>'ram' AS ram, s.extra->>'storage' AS storage,
            t.config_verified
       FROM vendor_serial_numbers s
       LEFT JOIN users au ON au.user_id = s.waiver_approved_by
       LEFT JOIN grn_serial_capture_tokens t ON t.token_id::text = s.capture_token_id::text
      WHERE s.grn_id = $1 AND s.deleted_at IS NULL
      ORDER BY s.serial_id`,
    [d.grn_id]
  )).rows : [];
  res.json({
    success: true,
    data: { ...d, lines: lines.map((l, i) => ({ ...l, line_index: i })), units },
  });
}

const completeValidators = [
  param('id').isInt().toInt(),
  body('note').optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
];
/** POST /deliveries/:id/complete — receiving on this delivery is finished. */
async function complete(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return bad(res, errors);
  const id = Number(req.params.id);
  const note = String(req.body.note || '').trim();
  const d = (await pool.query(`${DELIVERY_SELECT} WHERE d.delivery_id = $1`, [id])).rows[0];
  if (!d) return res.status(404).json({ success: false, message: 'Delivery not found' });
  if (!['arrived', 'receiving'].includes(d.status)) return res.status(409).json({ success: false, message: `This delivery is already ${d.status}.` });
  const handled = d.received_count + d.rejected_count;
  const next = handled === 0 ? 'cancelled' : 'received';
  if (handled !== Number(d.laptop_count) && note.length < 5) {
    return res.status(400).json({
      success: false,
      code: 'COUNT_MISMATCH',
      message: `The guard logged ${d.laptop_count} laptop(s); ${handled} were received. Say what happened to the difference.`,
    });
  }
  const u = await pool.query(
    `UPDATE vendor_deliveries SET status = $1, completed_at = NOW(), completed_by = $2, completion_note = NULLIF($3, ''), updated_at = NOW()
      WHERE delivery_id = $4 AND status IN ('arrived', 'receiving') RETURNING *`,
    [next, req.user?.user_id || null, note, id]
  );
  if (!u.rows.length) return res.status(409).json({ success: false, message: 'Someone else closed this delivery just now.' });
  await logVendorAudit({
    actorUserId: req.user?.user_id, vendorId: d.vendor_id, entityType: 'vendor_delivery', entityId: String(id),
    action: next === 'cancelled' ? 'turned_away' : 'receiving_complete',
    payload: { logged: d.laptop_count, received: d.received_count, rejected: d.rejected_count, note },
  });
  res.json({ success: true, data: u.rows[0] });
}

const invoiceValidators = [
  param('id').isInt().toInt(),
  body('vendor_invoice_no').isString().trim().isLength({ min: 1, max: 100 }).withMessage("Enter the vendor's invoice number"),
];
/** PATCH /deliveries/:id/invoice — D7: the invoice number, needed before the vendor is paid. */
async function setInvoice(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return bad(res, errors);
  const id = Number(req.params.id);
  const inv = req.body.vendor_invoice_no;
  const d = (await pool.query('SELECT delivery_id, vendor_id, grn_id FROM vendor_deliveries WHERE delivery_id = $1', [id])).rows[0];
  if (!d) return res.status(404).json({ success: false, message: 'Delivery not found' });
  const dup = await pool.query(
    'SELECT delivery_number FROM vendor_deliveries WHERE vendor_id = $1 AND UPPER(vendor_invoice_no) = UPPER($2) AND delivery_id <> $3 LIMIT 1',
    [d.vendor_id, inv, id]
  );
  if (dup.rows.length) return res.status(409).json({ success: false, message: `Invoice ${inv} is already on ${dup.rows[0].delivery_number} from this vendor.` });
  await pool.query('UPDATE vendor_deliveries SET vendor_invoice_no = $1, updated_at = NOW() WHERE delivery_id = $2', [inv, id]);
  if (d.grn_id) {
    await pool.query(
      'UPDATE vendor_goods_received_notes SET vendor_invoice_no = $1, bill_name = COALESCE(bill_name, $1), updated_at = NOW() WHERE grn_id = $2',
      [inv, d.grn_id]
    );
  }
  res.json({ success: true, data: { delivery_id: id, vendor_invoice_no: inv } });
}

/** POST /serials/:serialId/approve-waiver — D5: a manager accepts a laptop received unchecked. */
async function approveWaiver(req, res) {
  if (!isManager(req.user)) return res.status(403).json({ success: false, message: 'Only a manager can approve a laptop received without the configuration check.' });
  const serialId = Number(req.params.serialId);
  if (!Number.isInteger(serialId)) return res.status(400).json({ success: false, message: 'Bad serial' });
  const u = await pool.query(
    `UPDATE vendor_serial_numbers SET waiver_approved_by = $1, waiver_approved_at = NOW()
      WHERE serial_id = $2 AND config_capture_waived AND waiver_approved_at IS NULL
      RETURNING serial_id, inventory_asset_code`,
    [req.user?.user_id || null, serialId]
  );
  if (!u.rows.length) return res.status(409).json({ success: false, message: 'Nothing to approve: this laptop was checked, or its waiver is already approved.' });
  await logVendorAudit({
    actorUserId: req.user?.user_id, vendorId: null, entityType: 'serial_number', entityId: String(serialId),
    action: 'waiver_approved', payload: { ttspl_id: u.rows[0].inventory_asset_code },
  });
  res.json({ success: true, data: u.rows[0] });
}

const wrap = (name, fn) => async (req, res) => {
  try { await fn(req, res); } catch (e) {
    console.error(`vendorDeliveries.${name}:`, e);
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = {
  listValidators,
  createValidators,
  completeValidators,
  invoiceValidators,
  expected: wrap('expected', expected),
  list: wrap('list', list),
  create: wrap('create', create),
  getOne: wrap('getOne', getOne),
  complete: wrap('complete', complete),
  setInvoice: wrap('setInvoice', setInvoice),
  approveWaiver: wrap('approveWaiver', approveWaiver),
};
