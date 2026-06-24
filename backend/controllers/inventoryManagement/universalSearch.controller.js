const { query, validationResult } = require('express-validator');
const pool = require('../../config/db');
const { enrichSerialRowsBatch } = require('../../services/inventoryManagementService');

const searchValidators = [query('search').notEmpty().trim()];

async function universalSearch(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const search = String(req.query.search).trim().toUpperCase();

  try {
    const exactR = await pool.query(
      `SELECT
         s.serial_id, s.serial_number, s.inventory_asset_code, s.qc_status, s.remark,
         s.extra, s.created_at AS serial_created_at, s.updated_at AS serial_updated_at,
         s.rental_start_date, s.grn_id, s.inventory_status, s.spo_id,
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
           UPPER(s.serial_number) = $1
           OR UPPER(COALESCE(s.inventory_asset_code, '')) = $1
         )
       LIMIT 5`,
      [search]
    );

    if (exactR.rows.length) {
      return res.json({
        success: true,
        found_in: 'serial_numbers',
        data: await enrichSerialRowsBatch(pool, exactR.rows)
      });
    }

    const spareR = await pool.query(
      `SELECT s.*, sp.purchase_order_number, v.business_name
       FROM vendor_serial_numbers s
       LEFT JOIN vendor_spare_parts_purchase_orders sp ON sp.spo_id = s.spo_id
       LEFT JOIN vendors v ON v.vendor_id = sp.vendor_id
       WHERE s.deleted_at IS NULL AND s.spo_id IS NOT NULL
         AND (UPPER(s.serial_number) = $1 OR UPPER(COALESCE(s.inventory_asset_code, '')) = $1)
       LIMIT 5`,
      [search]
    );

    if (spareR.rows.length) {
      return res.json({
        success: true,
        found_in: 'serial_number_parts',
        data: spareR.rows
      });
    }

    const fuzzyR = await pool.query(
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
           OR p.purchase_order_number ILIKE $1
         )
       ORDER BY s.updated_at DESC
       LIMIT 25`,
      [`%${search}%`]
    );

    if (fuzzyR.rows.length) {
      return res.json({
        success: true,
        found_in: 'serial_numbers_fuzzy',
        data: await enrichSerialRowsBatch(pool, fuzzyR.rows)
      });
    }

    res.json({ success: false, found_in: null, data: null, message: 'No matching asset found' });
  } catch (e) {
    console.error('universalSearch', e);
    res.status(500).json({ success: false, message: e.message || 'Search failed' });
  }
}

module.exports = { searchValidators, universalSearch };
