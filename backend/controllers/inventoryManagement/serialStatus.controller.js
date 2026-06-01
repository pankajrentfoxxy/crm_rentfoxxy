const { query, validationResult } = require('express-validator');
const pool = require('../../config/db');
const { enrichSerialRow } = require('../../services/inventoryManagementService');

const searchValidators = [query('serial_number').notEmpty().trim()];

async function serialNumberStatus(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const serial = String(req.query.serial_number).trim();

  try {
    const rowsR = await pool.query(
      `SELECT
         s.serial_id, s.serial_number, s.inventory_asset_code, s.qc_status, s.remark,
         s.extra, s.created_at AS serial_created_at, s.updated_at AS serial_updated_at,
         s.rental_start_date, s.grn_id, s.inventory_status,
         p.po_id, p.purchase_order_number, p.purchase_order_type, p.vendor_id, p.line_items,
         v.business_name, v.first_name || ' ' || v.last_name AS vendor_name
       FROM vendor_serial_numbers s
       LEFT JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
       LEFT JOIN vendors v ON v.vendor_id = p.vendor_id AND v.deleted_at IS NULL
       WHERE s.deleted_at IS NULL
         AND (
           s.serial_number ILIKE $1
           OR COALESCE(s.inventory_asset_code, '') ILIKE $1
         )
       ORDER BY s.serial_id DESC`,
      [`%${serial}%`]
    );

    const serialRows = rowsR.rows.map(enrichSerialRow);

    const inwardR = await pool.query(
      `SELECT * FROM allocation_logs WHERE serial_number ILIKE $1 AND in_ward = 'active' ORDER BY id DESC`,
      [`%${serial}%`]
    );
    const outwardR = await pool.query(
      `SELECT * FROM allocation_logs WHERE serial_number ILIKE $1 AND out_ward = 'active' ORDER BY id DESC`,
      [`%${serial}%`]
    );
    const txR = await pool.query(
      `SELECT * FROM inward_outward
       WHERE product_type IS DISTINCT FROM 'parts'
         AND (serial_number ILIKE $1 OR unique_number ILIKE $1)
       ORDER BY id DESC`,
      [`%${serial}%`]
    );

    res.json({
      success: true,
      serial_number: serial,
      serials: serialRows,
      inward: inwardR.rows,
      outward: outwardR.rows,
      transactions: txR.rows
    });
  } catch (e) {
    console.error('serialNumberStatus', e);
    res.status(500).json({ success: false, message: e.message || 'Search failed' });
  }
}

module.exports = { searchValidators, serialNumberStatus };
