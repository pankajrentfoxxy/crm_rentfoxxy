const { param, validationResult } = require('express-validator');
const { body } = require('express-validator');
const pool = require('../../config/db');
const { logVendorAudit } = require('../../services/vendorAuditLogService');

async function listGrnForPo(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });
  const poId = Number(req.params.poId);
  const r = await pool.query(
    `SELECT * FROM vendor_goods_received_notes WHERE po_id = $1 AND deleted_at IS NULL ORDER BY grn_id`,
    [poId]
  );
  res.json({ success: true, data: r.rows });
}

const grnCreateValidators = [body('meta').optional().isObject()];

async function createGrn(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const poId = Number(req.params.poId);
  const meta = req.body?.meta ?? {};
  const po = await pool.query(`SELECT 1 FROM vendor_purchase_orders WHERE po_id = $1 AND deleted_at IS NULL`, [
    poId
  ]);
  if (!po.rows.length) return res.status(404).json({ success: false, message: 'PO not found' });

  const ins = await pool.query(
    `INSERT INTO vendor_goods_received_notes (po_id, meta) VALUES ($1, $2::jsonb) RETURNING *`,
    [poId, JSON.stringify(meta)]
  );

  await logVendorAudit({
    actorUserId: req.user?.user_id,
    vendorId: null,
    entityType: 'grn',
    entityId: ins.rows[0].grn_id,
    action: 'create',
    payload: { po_id: poId }
  });

  res.status(201).json({ success: true, data: ins.rows[0] });
}

async function listSerials(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const grnId = Number(req.params.grnId);
  const poId = Number(req.params.poId);

  const r = await pool.query(
    `SELECT * FROM vendor_serial_numbers
     WHERE po_id = $1 AND grn_id = $2 AND deleted_at IS NULL
     ORDER BY serial_id`,
    [poId, grnId]
  );
  res.json({ success: true, data: r.rows });
}

const serialUpdateValidators = [
  body('new_serial').notEmpty().trim(),
  body('old_serial').notEmpty().trim(),
  body('grn_id').isInt().toInt(),
  body('po_id').isInt().toInt()
];

async function checkAndUpdate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const newSerial = String(req.body.new_serial || '').trim();
  const oldSerial = String(req.body.old_serial || '').trim();
  const grnId = Number(req.body.grn_id);
  const poId = Number(req.body.po_id);

  if (!newSerial) {
    return res.json({ success: false, message: 'Please Enter New Serial Number ..!!' });
  }

  const existsOther = await pool.query(
    `SELECT serial_id FROM vendor_serial_numbers
     WHERE LOWER(serial_number) = LOWER($1) AND deleted_at IS NULL`,
    [newSerial]
  );

  const currentRow = await pool.query(
    `SELECT serial_id FROM vendor_serial_numbers
     WHERE po_id = $1 AND grn_id = $2 AND LOWER(serial_number) = LOWER($3) AND deleted_at IS NULL`,
    [poId, grnId, oldSerial]
  );

  if (
    existsOther.rows.length &&
    currentRow.rows.length &&
    Number(existsOther.rows[0].serial_id) !== Number(currentRow.rows[0].serial_id)
  ) {
    return res.json({
      success: false,
      message: 'Serial number already exists. Duplicate serials not allowed..!!'
    });
  }

  const updated = await pool.query(
    `UPDATE vendor_serial_numbers
     SET serial_number = $1, updated_at = NOW()
     WHERE LOWER(serial_number) = LOWER($2)
       AND po_id = $3
       AND grn_id = $4
       AND deleted_at IS NULL`,
    [newSerial, oldSerial, poId, grnId]
  );

  if (updated.rowCount > 0) {
    await pool.query(
      `INSERT INTO vendor_serial_number_audit (po_id, grn_id, old_serial, new_serial, changed_by_user_id)
       VALUES ($1,$2,$3,$4,$5)`,
      [poId, grnId, oldSerial, newSerial, req.user?.user_id || null]
    );
    await logVendorAudit({
      actorUserId: req.user?.user_id,
      vendorId: null,
      entityType: 'serial_number',
      entityId: newSerial,
      action: 'update',
      payload: { old_serial: oldSerial, grn_id: grnId, po_id: poId }
    });
    return res.json({
      success: true,
      message: 'Serial Number Updated Successfully..!!',
      old_serial_number: newSerial
    });
  }

  return res.json({ success: false, message: 'Failed to update serial number. Try again.' });
}

async function createSerial(req, res) {
  await Promise.all([
    body('po_id').isInt().toInt().run(req),
    body('grn_id').isInt().toInt().run(req),
    body('serial_number').notEmpty().trim().run(req)
  ]);

  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const { po_id, grn_id, serial_number } = req.body;
  const extra = req.body.extra || {};

  try {
    const ins = await pool.query(
      `INSERT INTO vendor_serial_numbers (po_id, grn_id, serial_number, extra)
       VALUES ($1,$2,$3,$4::jsonb) RETURNING *`,
      [po_id, grn_id, serial_number, JSON.stringify(extra)]
    );
    res.status(201).json({ success: true, data: ins.rows[0] });
  } catch (e) {
    if (String(e.code) === '23505') {
      return res.status(409).json({ success: false, message: 'Serial number already exists' });
    }
    console.error(e);
    res.status(500).json({ success: false, message: e.message });
  }
}

module.exports = {
  grnPoParam: [param('poId').isInt().toInt()],
  serialParams: [param('grnId').isInt().toInt(), param('poId').isInt().toInt()],
  listGrnForPo,
  grnCreateValidators,
  createGrn,
  listSerials,
  serialUpdateValidators,
  checkAndUpdate,
  createSerial
};
