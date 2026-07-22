const { query, validationResult } = require('express-validator');
const pool = require('../../config/db');
const { enrichSerialRowsBatch } = require('../../services/inventoryManagementService');
const { loadErpSerialHistory } = require('../../services/erpSerialHistoryService');

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
         p.product_details_legacy_ids,
         v.business_name, v.first_name || ' ' || v.last_name AS vendor_name,
         g.meta->>'product_id' AS grn_product_id
       FROM vendor_serial_numbers s
       LEFT JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
       LEFT JOIN vendors v ON v.vendor_id = p.vendor_id AND v.deleted_at IS NULL
       LEFT JOIN vendor_goods_received_notes g ON g.grn_id = s.grn_id AND g.deleted_at IS NULL
       WHERE s.deleted_at IS NULL
         AND (
           s.serial_number ILIKE $1
           OR COALESCE(s.inventory_asset_code, '') ILIKE $1
           OR COALESCE(s.extra->>'unique_product_serial', '') ILIKE $1
         )
       ORDER BY s.serial_id DESC`,
      [`%${serial}%`]
    );

    const serialRows = await enrichSerialRowsBatch(pool, rowsR.rows);
    const erpHistory = await loadErpSerialHistory(pool, serial);

    res.json({
      success: true,
      serial_number: serial,
      serials: serialRows,
      /** @deprecated Use erp_history_* — kept for backward compatibility */
      inward: erpHistory.erp_history_inward,
      outward: erpHistory.erp_history_outward,
      transactions: erpHistory.erp_history_summary,
      erp_history: erpHistory.erp_history,
      erp_history_inward: erpHistory.erp_history_inward,
      erp_history_outward: erpHistory.erp_history_outward,
      erp_history_summary: erpHistory.erp_history_summary,
      erp_history_count: erpHistory.erp_history_count,
      has_migrated_serial: erpHistory.has_migrated_serial
    });
  } catch (e) {
    console.error('serialNumberStatus', e);
    res.status(500).json({ success: false, message: e.message || 'Search failed' });
  }
}

module.exports = { searchValidators, serialNumberStatus };
