const { param, query, validationResult } = require('express-validator');
const pool = require('../../config/db');
const {
  normalizeListSegment,
  listTitleForSegment,
  buildListWhere,
  enrichSerialRow,
  enrichSparePartRow
} = require('../../services/inventoryManagementService');

const listValidators = [
  param('segment').isString().trim(),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 500 }).toInt(),
  query('search').optional().isString().trim()
];

async function listInventory(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const segment = normalizeListSegment(req.params.segment);
  if (!segment) return res.status(400).json({ success: false, message: 'Invalid inventory segment' });

  const page = req.query.page || 1;
  const limit = req.query.limit || 50;
  const offset = (page - 1) * limit;
  const search = (req.query.search || '').trim();
  const isSpare = segment === 'spare_parts';

  try {
    if (isSpare) {
      const params = [];
      let searchSql = '';
      if (search) {
        params.push(`%${search}%`);
        const i = params.length;
        searchSql = ` AND (
          s.serial_number ILIKE $${i}
          OR COALESCE(s.inventory_asset_code, '') ILIKE $${i}
          OR sp.purchase_order_number ILIKE $${i}
          OR COALESCE(v.business_name, '') ILIKE $${i}
        )`;
      }
      const fromSql = `
        FROM vendor_serial_numbers s
        INNER JOIN vendor_spare_parts_purchase_orders sp ON sp.spo_id = s.spo_id AND sp.deleted_at IS NULL
        LEFT JOIN vendors v ON v.vendor_id = sp.vendor_id AND v.deleted_at IS NULL
        LEFT JOIN vendor_spare_parts_catalog c ON c.part_id::text = s.extra->>'part_id'
        WHERE s.deleted_at IS NULL AND s.spo_id IS NOT NULL
        ${searchSql}
      `;
      const countR = await pool.query(`SELECT COUNT(*)::int AS total ${fromSql}`, params);
      const total = countR.rows[0]?.total || 0;
      const listParams = [...params, limit, offset];
      const rowsR = await pool.query(
        `SELECT s.*, sp.purchase_order_number, v.business_name, c.name AS catalog_name
         ${fromSql}
         ORDER BY s.updated_at DESC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams
      );
      return res.json({
        success: true,
        segment,
        title: listTitleForSegment(segment),
        data: rowsR.rows.map(enrichSparePartRow),
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) }
      });
    }

    const params = [];
    const { sql: segmentSql } = buildListWhere(segment, params);
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
      ${segmentSql}
      ${searchSql}
    `;
    const countR = await pool.query(`SELECT COUNT(*)::int AS total ${fromSql}`, params);
    const total = countR.rows[0]?.total || 0;
    const listParams = [...params, limit, offset];
    const rowsR = await pool.query(
      `SELECT
         s.serial_id, s.serial_number, s.inventory_asset_code, s.qc_status, s.remark,
         s.extra, s.created_at AS serial_created_at, s.updated_at AS serial_updated_at,
         s.rental_start_date, s.grn_id, s.inventory_status,
         p.po_id, p.purchase_order_number, p.purchase_order_type, p.vendor_id, p.line_items,
         v.business_name, v.first_name || ' ' || v.last_name AS vendor_name
       ${fromSql}
       ORDER BY s.updated_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );
    res.json({
      success: true,
      segment,
      title: listTitleForSegment(segment),
      data: rowsR.rows.map(enrichSerialRow),
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) }
    });
  } catch (e) {
    console.error('listInventory', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to load inventory list' });
  }
}

async function getListCounts(req, res) {
  try {
    const keys = ['passed', 'rent_to_own', 'rental_purchase', 'direct_purchase', 'out_for_repare', 'spare_parts'];
    const counts = {};
    for (const seg of keys) {
      const params = [];
      const { sql: segmentSql } = buildListWhere(seg, params);
      if (seg === 'spare_parts') {
        const r = await pool.query(
          `SELECT COUNT(*)::int AS c FROM vendor_serial_numbers s
           WHERE s.deleted_at IS NULL AND s.spo_id IS NOT NULL`,
          []
        );
        counts[seg] = r.rows[0]?.c || 0;
      } else {
        const r = await pool.query(
          `SELECT COUNT(*)::int AS c
           FROM vendor_serial_numbers s
           INNER JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
           WHERE s.deleted_at IS NULL ${segmentSql}`,
          params
        );
        counts[seg] = r.rows[0]?.c || 0;
      }
    }
    counts.npa = 0;
    res.json({ success: true, counts });
  } catch (e) {
    console.error('getListCounts', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to load counts' });
  }
}

module.exports = { listValidators, listInventory, getListCounts };
