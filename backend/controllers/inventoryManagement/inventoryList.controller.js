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
  attachSoAttachmentIndicators,
  SPARE_STATUS_VALUES
} = require('../../services/inventoryManagementService');
const { DEPLOYED_WITH_CUSTOMER_STATUSES, displayDeployedStatus } = require('../../services/customerDeployedAssets');
const { appendDateRangeClauses } = require('../../utils/dateRangeFilter');
const { pickSpecFilters } = require('../../utils/inventorySpecFilter');
const { listInventorySerials } = require('../../services/inventoryListService');
const { invalidateInventoryListCachesFireAndForget } = require('../../services/inventoryListCache');
const { perfEnabled } = require('../../utils/performanceLogger');
const {
  buildInventorySerialListQuery,
  listSelectSql,
  attachSerialTicketIds,
} = require('../../utils/inventoryListQuery');
const { getInventoryTagAccess } = require('../../services/inventoryTagAccessScope');
const { hasPermission } = require('../../services/permissionService');

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
  query('tab').optional().isString().trim(),
  query('date_from').optional().isString().trim(),
  query('date_to').optional().isString().trim(),
  query('brand').optional().isString().trim(),
  query('model').optional().isString().trim(),
  query('processor').optional().isString().trim(),
  query('generation').optional().isString().trim(),
  query('ram').optional().isString().trim(),
  query('storage').optional().isString().trim(),
  query('screen_size').optional().isString().trim(),
  query('gpu').optional().isString().trim(),
  query('cursor').optional().isString().trim(),
  query('ticket_stage_filter').optional().isIn(['all', 'qc1_qc2']),
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
  const dateFrom = req.query.date_from;
  const dateTo = req.query.date_to;
  const specFilters = pickSpecFilters(req.query);
  const ticketStageFilter = ['qc1_qc2', 'dispatch_qc'].includes(req.query.ticket_stage_filter)
    ? req.query.ticket_stage_filter
    : 'all';
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
      const spareDateClauses = appendDateRangeClauses({
        column: 'updated_at', dateFrom, dateTo, params, tableAlias: 's',
      });
      const spareDateSql = spareDateClauses.length ? ` AND ${spareDateClauses.join(' AND ')}` : '';
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
        ${searchSql}${spareDateSql}
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

    const cursor = (req.query.cursor || '').trim() || undefined;
    const { payload, perf } = await listInventorySerials({
      segment,
      page,
      limit,
      offset,
      search,
      dateFrom,
      dateTo,
      specFilters,
      cursor,
      ticketStageFilter,
      user: req.user,
    });
    if (perfEnabled() && perf?.total != null) {
      res.setHeader('X-Perf-Total-Ms', String(perf.total));
    }
    return res.json(payload);
  } catch (e) {
    console.error('listInventory', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to load inventory list' });
  }
}

async function exportInventoryExcel(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const segment = normalizeListSegment(req.params.segment);
  if (!segment) return res.status(400).json({ success: false, message: 'Invalid inventory segment' });
  if (segment === 'spare_parts') {
    return res.status(400).json({ success: false, message: 'Export not supported for spare parts' });
  }

  const search = (req.query.search || '').trim();
  const dateFrom = req.query.date_from;
  const dateTo = req.query.date_to;
  const specFilters = pickSpecFilters(req.query);
  const ticketStageFilter = ['qc1_qc2', 'dispatch_qc'].includes(req.query.ticket_stage_filter)
    ? req.query.ticket_stage_filter
    : 'all';
  const limit = Math.min(20000, Math.max(1, parseInt(req.query.limit, 10) || 20000));

  try {
    const inventoryTagAccess = segment === 'passed'
      ? await getInventoryTagAccess(req.user)
      : 'all';
    const useBatchTickets = segment === 'passed';
    const listQuery = buildInventorySerialListQuery({
      segment,
      search,
      dateFrom,
      dateTo,
      specFilters,
      includeTicketJoins: !useBatchTickets,
      includeGrnJoin: true,
      ticketStageFilter,
      inventoryTagAccess,
    });
    const listParams = [...listQuery.params, limit];
    const selectSql = listSelectSql(!useBatchTickets);
    const rowsR = await pool.query(
      `SELECT ${selectSql} ${listQuery.fromSql}
       ORDER BY s.updated_at DESC
       LIMIT $${listParams.length}`,
      listParams
    );
    if (useBatchTickets) {
      await attachSerialTicketIds(pool, rowsR.rows);
    }
    const data = await enrichSerialRowsBatch(pool, rowsR.rows);
    const enriched = segment === 'passed'
      ? await attachSoAttachmentIndicators(pool, data)
      : data;
    const XLSX = require('xlsx');
    const sheetRows = enriched.map((r, idx) => {
      const receivedFrom = r.received_from?.type === 'vendor'
        ? (r.vendor_name || 'Vendor')
        : (r.received_from?.label || r.vendor_name || 'Vendor');
      const item = r.item_description && typeof r.item_description === 'object' ? r.item_description : {};
      const base = {
        'S.No': idx + 1,
        TTSPL: r.unique_product_serial || '',
        'Serial Number': r.serial_number || '',
        'PO Number': r.purchase_order_number || '',
        'GRN Number': r.grn_number || '',
        Brand: item.brand || '',
        Model: item.model || '',
        Processor: item.processor || '',
        Generation: item.generation || '',
        RAM: item.ram || '',
        HDD: item.storage || '',
        'Screen Size': item.screen_size || '',
        Graphics: item.gpu || '',
        'Locking Period': r.locking_period?.label || '',
        'PO Type': r.purchase_order_type_label || '',
        'PO Type Period': r.po_type_period?.label || '',
        'Received From': receivedFrom,
        Status: segment === 'passed' ? 'QC Passed' : (r.qc_status || '').replace(/_/g, ' '),
        'Vendor Name': r.vendor_name || '',
      };
      if (segment === 'qc_process') {
        return { ...base, 'Ticket Stage': r.ticket_stage_name || '' };
      }
      if (segment === 'qc_pending') {
        return { ...base, Remark: r.remark || r.action_remark || '' };
      }
      if (segment === 'passed') {
        return {
          ...base,
          'Tagged As': r.inventory_tag || '',
          'SO Attached': r.so_attachment?.sales_order_number || '',
          'SO Customer': r.so_attachment?.customer_name || '',
        };
      }
      return base;
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(sheetRows);
    XLSX.utils.book_append_sheet(wb, ws, listTitleForSegment(segment).slice(0, 31));
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const safeSegment = String(segment).replace(/[^\w-]+/g, '_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${safeSegment}_inventory.xlsx"`);
    res.send(buf);
  } catch (e) {
    console.error('exportInventoryExcel', e);
    res.status(500).json({ success: false, message: e.message || 'Export failed' });
  }
}

async function getListCounts(req, res) {
  try {
    const keys = ['passed', 'qc_pending', 'qc_process', 'dead_laptops', 'missing_laptops', 'rent_to_own', 'rental_purchase', 'direct_purchase', 'out_for_repare', 'failed', 'spare_parts'];
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

    invalidateInventoryListCachesFireAndForget();
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

    invalidateInventoryListCachesFireAndForget();
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

/** Tag a vendor serial as rental / sale / both (stored in extra.inventory_tag) — super_admin only after receive. */
async function tagInventoryItem(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  if (req.user?.role !== 'super_admin') {
    return res.status(403).json({
      success: false,
      message: 'Only Super Admin can change inventory tags after receive'
    });
  }

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

    invalidateInventoryListCachesFireAndForget();
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

/** Inventory / QC edit — correct item description (stored on serial extra). */
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

    const userId = req.user?.user_id;
    const role = req.user?.role;
    const isSuperAdmin = role === 'super_admin';
    const canInvEdit = isSuperAdmin
      || await hasPermission(userId, role, 'inventory_management', 'can_edit');
    const canQcEdit = isSuperAdmin
      || await hasPermission(userId, role, 'qc_management', 'can_edit');

    const effectiveQc = String(row.qc_status || parseExtra(row.extra).status || 'pending').trim();
    const canEditPassed = effectiveQc === 'passed' && canInvEdit;
    const canEditQcProcess = effectiveQc === 'pending' && (canInvEdit || canQcEdit);
    if (!canEditPassed && !canEditQcProcess) {
      return res.status(403).json({
        success: false,
        message: effectiveQc === 'passed'
          ? 'You do not have permission to edit specs on Ready to Rent/Sell units'
          : 'Item description can only be edited on QC Process (pending) or Ready to Rent/Sell (passed) units'
      });
    }

    const extra = parseExtra(row.extra);
    const mergedSpec = {};
    for (const field of SPEC_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(payload, field)) {
        mergedSpec[field] = payload[field];
      } else if (field === 'model') {
        mergedSpec[field] = extra.model || extra.model_name || '';
      } else {
        mergedSpec[field] = extra[field] || '';
      }
    }
    const { validateLaptopSpecForEdit, normalizeLaptopSpecForEdit } = require('../../services/assetConfigurationService');
    const specErrors = await validateLaptopSpecForEdit(mergedSpec);
    if (specErrors.length) {
      return res.status(400).json({ success: false, message: specErrors.join('; ') });
    }

    const normalizedSpec = await normalizeLaptopSpecForEdit(mergedSpec);
    for (const field of SPEC_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(payload, field)) {
        payload[field] = normalizedSpec[field] || '';
      }
    }

    for (const [key, val] of Object.entries(payload)) {
      if (val) extra[key] = val;
      else delete extra[key];
      if (key === 'model') {
        extra.model_name = val || undefined;
        if (!val) delete extra.model_name;
      }
    }
    extra.spec_source = isSuperAdmin
      ? 'super_admin_override'
      : (canEditQcProcess && !canEditPassed ? 'qc_override' : 'inventory_override');
    extra.spec_corrected_at = new Date().toISOString();
    extra.spec_corrected_by = req.user?.user_id || null;

    await pool.query(
      `UPDATE vendor_serial_numbers SET extra = $1::jsonb, updated_at = NOW() WHERE serial_id = $2`,
      [JSON.stringify(extra), serialId]
    );

    const fullItemDesc = {};
    for (const field of SPEC_FIELDS) {
      const val = extra[field] || (field === 'model' ? extra.model_name : '');
      if (val != null && String(val).trim() !== '') fullItemDesc[field] = String(val).trim();
    }

    let ticketSync = { updated: 0, ticket_ids: [] };
    if (Object.keys(fullItemDesc).length) {
      const { syncLinkedTicketsFromItemDescription } = require('../../services/qcProcessIntakeService');
      try {
        ticketSync = await syncLinkedTicketsFromItemDescription(pool, {
          serialId: Number(serialId),
          serialNumber: row.serial_number,
          inventoryAssetCode: row.inventory_asset_code,
          itemDesc: fullItemDesc,
          userId: req.user?.user_id,
        });
      } catch (syncErr) {
        console.error('updateItemDescription ticket sync:', syncErr.message);
      }
    }

    const ttsplId = row.inventory_asset_code || row.serial_number;
    if (ttsplId) {
      await logTtsplEvent({
        ttsplId,
        vendorSerialId: serialId,
        eventType: 'item_description_updated',
        description: `Item description corrected (${extra.spec_source})`,
        metadata: { ...payload, tickets_synced: ticketSync.ticket_ids },
        actorUserId: req.user?.user_id,
      });
    }

    invalidateInventoryListCachesFireAndForget();
    res.json({
      success: true,
      message: ticketSync.updated
        ? `Item description updated. Synced to ${ticketSync.updated} floor ticket(s).`
        : 'Item description updated',
      item_description: payload,
      tickets_synced: ticketSync.ticket_ids,
    });
  } catch (e) {
    console.error('updateItemDescription', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to update item description' });
  }
}

const qcStatusValidators = [
  param('id').isInt().toInt(),
  body('qc_status').notEmpty().trim(),
  body('remark').optional({ nullable: true }).isString().trim(),
  body('create_floor_ticket').optional().isBoolean().toBoolean(),
];

/** Super admin — correct qc_status / inventory_status so inventory lists stay in sync. */
async function updateSerialQcStatus(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const { applySuperAdminSerialStatus } = require('../../services/inventoryStatusOverrideService');
    const result = await applySuperAdminSerialStatus(pool, {
      serialId: req.params.id,
      qcStatus: req.body.qc_status,
      remark: req.body.remark,
      createFloorTicket: req.body.create_floor_ticket === true,
      actorUserId: req.user?.user_id,
    });
    if (!result.ok) {
      return res.status(result.status || 400).json({ success: false, message: result.message });
    }
    invalidateInventoryListCachesFireAndForget();
    res.json({ success: true, message: result.message, data: result.data });
  } catch (e) {
    console.error('updateSerialQcStatus', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to update status' });
  }
}

const remarkValidators = [
  param('id').isInt().toInt(),
  body('remark').optional({ nullable: true }).isString().trim()
];

/** Admin — update inventory remark on QC Pending / QC Process / Dead lists. */
async function updateSerialRemark(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const { updateSerialRemark: applyRemark } = require('../../services/inventoryAssetMovementService');
    const result = await applyRemark(
      pool,
      { serialId: req.params.id, remark: req.body.remark },
      req.user?.user_id
    );
    if (!result.ok) {
      return res.status(result.status || 400).json({ success: false, message: result.message });
    }
    res.json({ success: true, message: result.message, data: result.data });
  } catch (e) {
    console.error('updateSerialRemark', e);
    res.status(500).json({ success: false, message: e.message || 'Failed to update remark' });
  }
}

module.exports = {
  listValidators,
  listInventory,
  exportInventoryExcel,
  getListCounts,
  readyToRentActionValidators,
  updateReadyToRentAction,
  changeSparePartStatusValidators,
  changeSparePartStatus,
  tagInventoryValidators,
  tagInventoryItem,
  itemDescriptionValidators,
  updateItemDescription,
  qcStatusValidators,
  updateSerialQcStatus,
  remarkValidators,
  updateSerialRemark,
  customerAssetsValidators,
  customerAssets
};
