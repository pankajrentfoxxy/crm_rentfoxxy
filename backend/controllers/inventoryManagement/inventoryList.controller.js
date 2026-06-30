const { param, query, body, validationResult } = require('express-validator');
const pool = require('../../config/db');
const { parseExtra } = require('../../services/qcManagementService');
const { logTtsplEvent } = require('../../services/ttsplAuditService');
const {
  normalizeListSegment,
  listTitleForSegment,
  buildListWhere,
  enrichSerialRow,
  enrichSerialRowsBatch,
  enrichSparePartRow,
  normalizeSpareTab,
  spareStatusForTab,
  effectiveSpareStatusSql,
  fetchSparePartTabCounts,
  SPARE_STATUS_VALUES
} = require('../../services/inventoryManagementService');
const { DEPLOYED_WITH_CUSTOMER_STATUSES, displayDeployedStatus } = require('../../services/customerDeployedAssets');

const READY_TO_RENT_SALE_VALUES = [
  'normal_sale',
  'clearance_sale',
  'rent',
  'rent_or_normal_sale'
];

const listValidators = [
  param('segment').isString().trim(),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 500 }).toInt(),
  query('search').optional().isString().trim(),
  query('tab').optional().isString().trim()
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
      const tab = normalizeSpareTab(req.query.tab);
      const tabStatus = spareStatusForTab(tab);
      const statusSql = effectiveSpareStatusSql('s');
      const params = [tabStatus];
      let searchSql = '';
      if (search) {
        params.push(`%${search}%`);
        const i = params.length;
        searchSql = ` AND (
          s.serial_number ILIKE $${i}
          OR COALESCE(s.inventory_asset_code, '') ILIKE $${i}
          OR sp.purchase_order_number ILIKE $${i}
          OR COALESCE(v.business_name, '') ILIKE $${i}
          OR COALESCE(v.first_name, '') ILIKE $${i}
          OR COALESCE(v.email, '') ILIKE $${i}
          OR COALESCE(s.extra->>'main_serial_number', '') ILIKE $${i}
        )`;
      }
      const fromSql = `
        FROM vendor_serial_numbers s
        INNER JOIN vendor_spare_parts_purchase_orders sp ON sp.spo_id = s.spo_id AND sp.deleted_at IS NULL
        LEFT JOIN vendors v ON v.vendor_id = sp.vendor_id AND v.deleted_at IS NULL
        LEFT JOIN vendor_spare_parts_catalog c ON c.part_id::text = s.extra->>'part_id'
        LEFT JOIN vendor_serial_numbers asset ON asset.deleted_at IS NULL
          AND asset.serial_number = COALESCE(s.extra->>'main_serial_number', '')
          AND asset.serial_number != ''
        LEFT JOIN vendor_purchase_orders apo ON apo.po_id = asset.po_id AND apo.deleted_at IS NULL
        WHERE s.deleted_at IS NULL AND s.spo_id IS NOT NULL
          AND ${statusSql} = $1
        ${searchSql}
      `;
      const tabCounts = await fetchSparePartTabCounts(pool);
      const countR = await pool.query(`SELECT COUNT(*)::int AS total ${fromSql}`, params);
      const total = countR.rows[0]?.total || 0;
      const listParams = [...params, limit, offset];
      const rowsR = await pool.query(
        `SELECT s.*,
                sp.purchase_order_number,
                sp.line_items,
                sp.vendor_id,
                v.business_name,
                v.first_name || COALESCE(' ' || NULLIF(v.last_name, ''), '') AS vendor_display_name,
                v.email AS vendor_email,
                v.phone AS vendor_phone,
                c.name AS catalog_name,
                s.extra->>'main_serial_number' AS main_serial_number,
                s.extra->>'main_unique_number' AS main_unique_number,
                apo.purchase_order_number AS asset_purchase_order_number,
                asset.grn_id AS asset_grn_id
         ${fromSql}
         ORDER BY s.updated_at DESC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams
      );
      return res.json({
        success: true,
        segment,
        tab,
        title: listTitleForSegment(segment),
        tabCounts,
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
      LEFT JOIN vendor_goods_received_notes g ON g.grn_id = s.grn_id AND g.deleted_at IS NULL
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
         p.product_details_legacy_ids,
         v.business_name, v.first_name || ' ' || v.last_name AS vendor_name,
         g.meta->>'product_id' AS grn_product_id,
         (SELECT t.ticket_id FROM tickets t
            WHERE t.vendor_serial_id = s.serial_id
            ORDER BY t.created_at DESC LIMIT 1) AS ticket_id,
         (SELECT t.ticket_id FROM tickets t
            WHERE t.vendor_serial_id = s.serial_id
              AND t.status IN ('in_progress', 'on_hold')
            ORDER BY t.created_at DESC LIMIT 1) AS active_floor_ticket_id
       ${fromSql}
       ORDER BY s.updated_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );
    const data = await enrichSerialRowsBatch(pool, rowsR.rows);
    res.json({
      success: true,
      segment,
      title: listTitleForSegment(segment),
      data,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) }
    });
  } catch (e) {
    console.error('listInventory', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to load inventory list' });
  }
}

async function getListCounts(req, res) {
  try {
    const keys = ['passed', 'qc_process', 'rent_to_own', 'rental_purchase', 'direct_purchase', 'out_for_repare', 'failed', 'spare_parts'];
    const counts = {};
    for (const seg of keys) {
      const params = [];
      const { sql: segmentSql } = buildListWhere(seg, params);
      if (seg === 'spare_parts') {
        const tabCounts = await fetchSparePartTabCounts(pool);
        counts[seg] = tabCounts.total;
        counts.spare_parts_tabs = tabCounts;
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

    try {
      const { countOutForRepairInventory } = require('../../services/vendorRepairDcService');
      counts.out_for_repair = await countOutForRepairInventory();
    } catch {
      counts.out_for_repair = 0;
    }

    const deployedR = await pool.query(
      `SELECT inventory_status, COUNT(*)::int AS c
         FROM vendor_serial_numbers
        WHERE deleted_at IS NULL
          AND inventory_status = ANY($1::text[])
        GROUP BY inventory_status`,
      [['reserved', 'in_transit', 'rented', 'on_demo', 'sold']]
    );
    counts.rented = 0;
    counts.sold = 0;
    for (const row of deployedR.rows) {
      if (row.inventory_status === 'rented') counts.rented = row.c;
      if (row.inventory_status === 'sold') counts.sold = row.c;
    }

    counts.npa = 0;
    // Phase 16: pending part requests awaiting warehouse action.
    try {
      const pr = await pool.query(
        `SELECT COUNT(*)::int AS c FROM part_requests WHERE status IN ('pending','escalated','received','ordered')`
      );
      counts.parts_pending = pr.rows[0]?.c || 0;
    } catch (_) { counts.parts_pending = 0; }
    res.json({ success: true, counts });
  } catch (e) {
    console.error('getListCounts', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to load counts' });
  }
}

const readyToRentActionValidators = [
  body('serial_number_id').isInt({ min: 1 }).toInt(),
  body('serial_number').notEmpty().trim(),
  body('selected_value').isIn(READY_TO_RENT_SALE_VALUES)
];

/** Laravel QualityCheckController@ReturnAndRepareCheckXYZ — status2 on passed serials */
async function updateReadyToRentAction(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const serialId = req.body.serial_number_id;
  const serialNumber = String(req.body.serial_number).trim();
  const selected = req.body.selected_value;

  try {
    const cur = await pool.query(
      `SELECT serial_id, extra, qc_status
       FROM vendor_serial_numbers
       WHERE serial_id = $1 AND serial_number = $2 AND deleted_at IS NULL AND po_id IS NOT NULL`,
      [serialId, serialNumber]
    );
    if (!cur.rows.length) {
      return res.status(404).json({ success: false, message: 'Serial not found' });
    }

    const row = cur.rows[0];
    const effectiveQc = String(row.qc_status || parseExtra(row.extra).status || 'pending').trim();
    if (effectiveQc !== 'passed') {
      return res.status(400).json({
        success: false,
        message: 'Only QC passed serials can be routed to sale or rent'
      });
    }

    const extra = parseExtra(row.extra);
    // The sale/rent disposition is NOT a lifecycle state — keep it in extra.status2
    // only. Writing it into inventory_status previously corrupted the canonical
    // state machine (e.g. 'normal_sale'), breaking later dispatch/delivery.
    extra.status2 = selected;

    await pool.query(
      `UPDATE vendor_serial_numbers
       SET extra = $1::jsonb,
           inventory_status = CASE
             WHEN inventory_status IN ('in_repair', 'repared')
               AND COALESCE(qc_status, extra->>'status', 'pending') = 'passed'
             THEN 'in_stock'
             WHEN inventory_status IS NULL
               OR inventory_status NOT IN (
                 'reserved','in_transit','rented','on_demo','sold',
                 'returned','qc_failed','scrapped'
               )
             THEN 'in_stock'
             ELSE inventory_status
           END,
           updated_at = NOW()
       WHERE serial_id = $2`,
      [JSON.stringify(extra), serialId]
    );

    res.json({ success: true, message: 'Action taken successfully!' });
  } catch (e) {
    console.error('updateReadyToRentAction', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to update action' });
  }
}

const changeSparePartStatusValidators = [
  body('serial_number_id').isInt({ min: 1 }).toInt(),
  body('serial_number').notEmpty().trim(),
  body('status').isIn([...SPARE_STATUS_VALUES])
];

/** Laravel BillingPersonController@inventoryListChangeStatus */
async function changeSparePartStatus(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const serialId = req.body.serial_number_id;
  const serialNumber = String(req.body.serial_number).trim();
  const status = req.body.status;

  try {
    const cur = await pool.query(
      `SELECT serial_id, extra FROM vendor_serial_numbers
       WHERE serial_id = $1 AND serial_number = $2 AND deleted_at IS NULL AND spo_id IS NOT NULL`,
      [serialId, serialNumber]
    );
    if (!cur.rows.length) {
      return res.status(404).json({ success: false, message: 'Spare part serial not found' });
    }

    const extra = parseExtra(cur.rows[0].extra);
    extra.status = status;

    await pool.query(
      `UPDATE vendor_serial_numbers
       SET qc_status = $1,
           extra = $2::jsonb,
           updated_at = NOW()
       WHERE serial_id = $3`,
      [status, JSON.stringify(extra), serialId]
    );

    res.json({ success: true, message: 'Status updated successfully.' });
  } catch (e) {
    console.error('changeSparePartStatus', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to update status' });
  }
}

// ─────────────────────────────────────────────────────────────
// Customer Assets — laptops currently deployed WITH customers.
// Derived live from vendor_serial_numbers (single source of truth):
// any unit that has left the warehouse to a customer.
// ─────────────────────────────────────────────────────────────
// 'reserved' = attached to an order but not yet dispatched; it has left the
// rentable shelf and is now allocated to a customer, so it belongs here.
const DEPLOYED_STATUSES = [...DEPLOYED_WITH_CUSTOMER_STATUSES];

const customerAssetsValidators = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 500 }).toInt(),
  query('search').optional().isString().trim(),
  query('status').optional().isString().trim()
];

async function customerAssets(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const page = req.query.page || 1;
  const limit = req.query.limit || 50;
  const offset = (page - 1) * limit;
  const search = (req.query.search || '').trim();
  const status = (req.query.status || '').trim();

  try {
    const params = [];
    let statusSql = '';
    if (status && DEPLOYED_STATUSES.includes(status)) {
      params.push(status);
      statusSql = ` AND s.inventory_status = $${params.length}`;
    } else {
      params.push(DEPLOYED_STATUSES);
      statusSql = ` AND s.inventory_status = ANY($${params.length})`;
    }

    let searchSql = '';
    if (search) {
      params.push(`%${search}%`);
      const i = params.length;
      searchSql = ` AND (
        s.serial_number ILIKE $${i}
        OR COALESCE(s.inventory_asset_code, '') ILIKE $${i}
        OR COALESCE(c.name, '') ILIKE $${i}
        OR COALESCE(c.company_name, '') ILIKE $${i}
        OR COALESCE(s.extra->>'model', s.extra->>'model_name', '') ILIKE $${i}
        OR COALESCE(s.current_dc_number, '') ILIKE $${i}
      )`;
    }

    const fromSql = `
      FROM vendor_serial_numbers s
      LEFT JOIN customers c ON c.customer_id = s.current_customer_id
      LEFT JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
      WHERE s.deleted_at IS NULL
      ${statusSql}
      ${searchSql}
    `;

    const countR = await pool.query(`SELECT COUNT(*)::int AS total ${fromSql}`, params);
    const total = countR.rows[0]?.total || 0;

    // status breakdown (ignores the status filter so the tabs always show totals)
    const breakdownParams = [DEPLOYED_STATUSES];
    let breakdownSearch = '';
    if (search) {
      breakdownParams.push(`%${search}%`);
      const i = breakdownParams.length;
      breakdownSearch = ` AND (
        s.serial_number ILIKE $${i}
        OR COALESCE(s.inventory_asset_code, '') ILIKE $${i}
        OR COALESCE(c.name, '') ILIKE $${i}
        OR COALESCE(c.company_name, '') ILIKE $${i}
        OR COALESCE(s.extra->>'model', s.extra->>'model_name', '') ILIKE $${i}
        OR COALESCE(s.current_dc_number, '') ILIKE $${i}
      )`;
    }
    const breakdownR = await pool.query(
      `SELECT s.inventory_status, COUNT(*)::int AS c
       FROM vendor_serial_numbers s
       LEFT JOIN customers c ON c.customer_id = s.current_customer_id
       WHERE s.deleted_at IS NULL AND s.inventory_status = ANY($1) ${breakdownSearch}
       GROUP BY s.inventory_status`,
      breakdownParams
    );
    const counts = { reserved: 0, in_transit: 0, rented: 0, on_demo: 0, sold: 0, all: 0 };
    breakdownR.rows.forEach((r) => {
      const key = displayDeployedStatus(r.inventory_status);
      if (counts[key] !== undefined) counts[key] += r.c;
      counts.all += r.c;
    });

    const listParams = [...params, limit, offset];
    const rowsR = await pool.query(
      `SELECT s.serial_id, s.serial_number, s.inventory_asset_code, s.inventory_status,
              s.current_dc_number, s.current_entity, s.dispatch_mode, s.dispatched_at,
              s.delivered_at, s.rent_start_date, s.rent_monthly_rate, s.extra,
              c.customer_id, c.name AS customer_name, c.company_name,
              p.purchase_order_type
       ${fromSql}
       ORDER BY s.status_changed_at DESC NULLS LAST, s.updated_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    const data = rowsR.rows.map((r) => {
      const ex = parseExtra(r.extra) || {};
      return {
        serial_id: r.serial_id,
        ttspl_id: r.inventory_asset_code || ex.ttspl_id || null,
        serial_number: r.serial_number,
        brand: ex.brand || null,
        model: ex.model || ex.model_name || null,
        processor: ex.processor || null,
        generation: ex.generation || null,
        ram: ex.ram || null,
        storage: ex.storage || null,
        inventory_status: displayDeployedStatus(r.inventory_status),
        customer_id: r.customer_id,
        customer_name: r.customer_name,
        company_name: r.company_name,
        dc_number: r.current_dc_number,
        entity_code: r.current_entity,
        dispatch_mode: r.dispatch_mode,
        dispatched_at: r.dispatched_at,
        delivered_at: r.delivered_at,
        rent_start_date: r.rent_start_date,
        rent_monthly_rate: r.rent_monthly_rate,
        purchase_order_type: r.purchase_order_type
      };
    });

    res.json({
      success: true,
      title: 'Customer Assets — Deployed Fleet',
      counts,
      data,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) }
    });
  } catch (e) {
    console.error('customerAssets', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to load customer assets' });
  }
}

// Disposition tag: 'rental' | 'sale' | 'both'. ('sales' kept for backward
// compatibility with previously stored values; normalised to 'sale'.)
const INVENTORY_TAGS = ['rental', 'sale', 'sales', 'both'];

const tagInventoryValidators = [
  param('id').isInt().toInt(),
  body('tag').isIn(INVENTORY_TAGS)
];

/** Tag a vendor serial as rental / sale / both (stored in extra.inventory_tag) */
async function tagInventoryItem(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const serialId = req.params.id;
  const tag = req.body.tag === 'sales' ? 'sale' : req.body.tag;

  try {
    const cur = await pool.query(
      `SELECT serial_id, serial_number, inventory_asset_code, extra
       FROM vendor_serial_numbers WHERE serial_id = $1 AND deleted_at IS NULL`,
      [serialId]
    );
    if (!cur.rows.length) {
      return res.status(404).json({ success: false, message: 'Serial not found' });
    }
    const row = cur.rows[0];
    const extra = parseExtra(row.extra);
    extra.inventory_tag = tag;

    await pool.query(
      `UPDATE vendor_serial_numbers SET extra = $1::jsonb, updated_at = NOW() WHERE serial_id = $2`,
      [JSON.stringify(extra), serialId]
    );

    const ttsplId = row.inventory_asset_code || row.serial_number;
    if (ttsplId) {
      await logTtsplEvent({
        ttsplId,
        vendorSerialId: serialId,
        eventType: 'inventory_tagged',
        description: `Inventory tagged as ${tag}`,
        metadata: { tag },
        actorUserId: req.user?.user_id
      });
    }

    res.json({ success: true, message: `Tagged as ${tag}`, tag });
  } catch (e) {
    console.error('tagInventoryItem', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to tag' });
  }
}

const SPEC_FIELDS = ['brand', 'model', 'processor', 'generation', 'ram', 'storage', 'gpu', 'screen_size'];

const itemDescriptionValidators = [
  param('id').isInt().toInt(),
  ...SPEC_FIELDS.map((field) => body(field).optional({ nullable: true }).isString().trim()),
];

/** Super admin — correct item description on Ready to Rent/Sell (stored on serial extra). */
async function updateItemDescription(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const serialId = req.params.id;
  const payload = {};
  for (const field of SPEC_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
      const val = req.body[field];
      payload[field] = val == null ? '' : String(val).trim();
    }
  }
  if (!Object.keys(payload).length) {
    return res.status(400).json({ success: false, message: 'Provide at least one field to update' });
  }

  try {
    const cur = await pool.query(
      `SELECT serial_id, serial_number, inventory_asset_code, extra, qc_status, po_id, inventory_status
         FROM vendor_serial_numbers
        WHERE serial_id = $1 AND deleted_at IS NULL`,
      [serialId]
    );
    if (!cur.rows.length) {
      return res.status(404).json({ success: false, message: 'Serial not found' });
    }
    const row = cur.rows[0];
    if (!row.po_id) {
      return res.status(400).json({ success: false, message: 'Only PO laptop serials can be updated here' });
    }

    const effectiveQc = String(row.qc_status || parseExtra(row.extra).status || 'pending').trim();
    if (effectiveQc !== 'passed') {
      return res.status(400).json({
        success: false,
        message: 'Item description can only be edited on QC passed (Ready to Rent/Sell) units'
      });
    }
    if (['rented', 'sold', 'in_transit', 'on_demo', 'reserved'].includes(String(row.inventory_status || ''))) {
      return res.status(400).json({
        success: false,
        message: 'Cannot edit description while unit is deployed or reserved'
      });
    }

    const extra = parseExtra(row.extra);
    for (const [key, val] of Object.entries(payload)) {
      if (val) extra[key] = val;
      else delete extra[key];
      if (key === 'model') {
        extra.model_name = val || undefined;
        if (!val) delete extra.model_name;
      }
    }
    extra.spec_source = 'super_admin_override';
    extra.spec_corrected_at = new Date().toISOString();
    extra.spec_corrected_by = req.user?.user_id || null;

    await pool.query(
      `UPDATE vendor_serial_numbers SET extra = $1::jsonb, updated_at = NOW() WHERE serial_id = $2`,
      [JSON.stringify(extra), serialId]
    );

    const ttsplId = row.inventory_asset_code || row.serial_number;
    if (ttsplId) {
      await logTtsplEvent({
        ttsplId,
        vendorSerialId: serialId,
        eventType: 'item_description_updated',
        description: 'Item description corrected (super admin)',
        metadata: payload,
        actorUserId: req.user?.user_id,
      });
    }

    res.json({ success: true, message: 'Item description updated', item_description: payload });
  } catch (e) {
    console.error('updateItemDescription', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to update item description' });
  }
}

module.exports = {
  listValidators,
  listInventory,
  getListCounts,
  readyToRentActionValidators,
  updateReadyToRentAction,
  changeSparePartStatusValidators,
  changeSparePartStatus,
  tagInventoryValidators,
  tagInventoryItem,
  itemDescriptionValidators,
  updateItemDescription,
  customerAssetsValidators,
  customerAssets
};
