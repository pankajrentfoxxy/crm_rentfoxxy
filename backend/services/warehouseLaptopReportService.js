/**
 * Warehouse Laptop Report — live snapshot of units physically in the warehouse.
 * Sibling to laptopReportService (ticket/date-scoped); does not replace it.
 */
const pool = require('../config/db');
const { parseMultiSpecValues } = require('../utils/inventorySpecFilter');
const {
  DEPLOYED_WITH_CUSTOMER_STATUSES,
  deployedStatusFilterSql,
} = require('./customerDeployedAssets');
const { readyToRentOrSellMatchSql, enrichSerialRowsBatch } = require('./inventoryManagementService');
const {
  REPORT_STAGES,
  PROCESSOR_BUCKETS_SHORT,
  appendMultiIlike,
  appendMultiProcessor,
} = require('./laptopReportService');

const PROC_FIELD = `COALESCE(NULLIF(TRIM(t.processor), ''), NULLIF(TRIM(pa.processor), ''), NULLIF(TRIM(s.extra->>'processor'), ''), '')`;
const BRAND_FIELD = `COALESCE(NULLIF(TRIM(t.brand), ''), NULLIF(TRIM(pa.brand), ''), NULLIF(TRIM(s.extra->>'brand'), ''), '')`;
const MODEL_FIELD = `COALESCE(NULLIF(TRIM(t.model), ''), NULLIF(TRIM(pa.model), ''), NULLIF(TRIM(s.extra->>'model'), ''), NULLIF(TRIM(s.extra->>'model_name'), ''), '')`;
const GEN_FIELD = `COALESCE(NULLIF(TRIM(s.extra->>'generation'), ''), NULLIF(TRIM(pa.generation), ''), '')`;
const RAM_FIELD = `COALESCE(NULLIF(TRIM(t.ram), ''), NULLIF(TRIM(pa.ram), ''), NULLIF(TRIM(s.extra->>'ram'), ''), '')`;
const STORAGE_FIELD = `COALESCE(NULLIF(TRIM(t.storage), ''), NULLIF(TRIM(pa.ssd), ''), NULLIF(TRIM(s.extra->>'storage'), ''), '')`;
const GRAPHICS_FIELD = `COALESCE(NULLIF(TRIM(pa.gpu), ''), NULLIF(TRIM(s.extra->>'gpu'), ''), '')`;
const SCREEN_FIELD = `COALESCE(NULLIF(TRIM(pa.screen_size), ''), NULLIF(TRIM(s.extra->>'screen_size'), ''), '')`;
const TTSPL_FIELD = `COALESCE(NULLIF(TRIM(s.inventory_asset_code), ''), NULLIF(TRIM(t.ttspl_id), ''), NULLIF(TRIM(pa.ttspl_id), ''))`;
const SERIAL_FIELD = `COALESCE(NULLIF(TRIM(s.serial_number), ''), NULLIF(TRIM(t.serial_number), ''))`;

/** Open laptop VRDC — used because qc_failed_return_vendor alone under-counts vs live VRDCs. */
const OPEN_VRDC_EXISTS = `
  EXISTS (
    SELECT 1
      FROM vendor_repair_dc_items i
      JOIN vendor_repair_delivery_challans d ON d.dc_number = i.dc_number
     WHERE COALESCE(i.serial_id, (
             SELECT ti.vendor_serial_id FROM tickets ti WHERE ti.ticket_id = i.ticket_id LIMIT 1
           )) = s.serial_id
       AND COALESCE(d.item_domain, 'laptop') = 'laptop'
       AND d.status IN ('dispatched', 'partially_returned')
  )
`;

const OUT_FOR_REPAIR_SQL = `
  (
    t.status = 'qc_failed_return_vendor'
    OR s.qc_status IN ('qc_failed_return_vendor', 'out_for_repare', 'out_for_repair')
    OR s.inventory_status IN ('out_for_repare', 'in_repair')
    OR ${OPEN_VRDC_EXISTS}
  )
`;

/** Exact match for /inventory-management/ready-to-rent-or-sell (segment passed). */
const READY_TO_RENT_SELL_SQL = readyToRentOrSellMatchSql('s');

const BUCKET_SQL = `
  CASE
    WHEN s.inventory_status = 'scrapped' THEN 'dead_scrapped'
    WHEN pa.production_asset_id IS NOT NULL THEN 'pending_inventory'
    WHEN ${OUT_FOR_REPAIR_SQL} THEN 'out_for_repair'
    /* Ready shelf before floor stages so KPI matches Inventory Ready-to-Rent page */
    WHEN ${READY_TO_RENT_SELL_SQL} THEN 'ready_to_rent_sell'
    WHEN st.stage_name = 'QC1' THEN 'qc1'
    WHEN st.stage_name = 'QC2' THEN 'qc2'
    WHEN st.stage_name = 'Diagnosis' THEN 'diagnosis'
    WHEN st.stage_name = 'Assembly & Software' THEN 'hardware_software'
    WHEN st.stage_name = 'Final Testing' THEN 'final_testing'
    ELSE 'other'
  END
`;

const BASE_FROM_SQL = `
  FROM vendor_serial_numbers s
  LEFT JOIN vendor_purchase_orders po ON po.po_id = s.po_id AND po.deleted_at IS NULL
  LEFT JOIN vendors v ON v.vendor_id = po.vendor_id AND v.deleted_at IS NULL
  LEFT JOIN tickets t
    ON t.vendor_serial_id = s.serial_id
   AND t.status NOT IN ('completed', 'cancelled')
  LEFT JOIN stages st ON st.stage_id = t.current_stage_id
  LEFT JOIN users tech ON tech.user_id = t.assigned_user_id
  LEFT JOIN production_assets pa
    ON pa.vendor_serial_id = s.serial_id
   AND pa.status = 'pending_inventory'
  LEFT JOIN users qc ON qc.user_id = pa.qc2_completed_by
`;

function vendorDisplaySql() {
  return `COALESCE(NULLIF(TRIM(v.business_name), ''), NULLIF(TRIM(CONCAT_WS(' ', v.first_name, v.last_name)), ''))`;
}

function buildWarehouseFilters(query = {}) {
  // Exclude customer-held units, but always keep Inventory "Ready to Rent or Sell"
  // rows (that page includes reserved+passed, which DEPLOYED would otherwise drop).
  const conditions = [
    's.deleted_at IS NULL',
    `(
      NOT (${deployedStatusFilterSql('s.inventory_status', '$1')})
      OR (${READY_TO_RENT_SELL_SQL})
    )`,
  ];
  const params = [[...DEPLOYED_WITH_CUSTOMER_STATUSES]];
  let idx = 2;

  const searchRaw = query.search != null ? String(query.search).trim() : '';
  if (searchRaw) {
    const term = `%${searchRaw}%`;
    conditions.push(`(
      ${TTSPL_FIELD} ILIKE $${idx}
      OR ${SERIAL_FIELD} ILIKE $${idx}
      OR ${BRAND_FIELD} ILIKE $${idx}
      OR ${MODEL_FIELD} ILIKE $${idx}
    )`);
    params.push(term);
    idx += 1;
  }

  if (query.brand && query.brand !== 'All') {
    idx = appendMultiIlike(parseMultiSpecValues(query.brand), BRAND_FIELD, conditions, params, idx);
  }
  if (query.model && query.model !== 'All') {
    idx = appendMultiIlike(parseMultiSpecValues(query.model), MODEL_FIELD, conditions, params, idx);
  }
  const procFilter = query.processor;
  if (procFilter && procFilter !== 'All') {
    idx = appendMultiProcessor(procFilter, conditions, params, idx, PROC_FIELD);
  }
  if (query.generation && query.generation !== 'All') {
    idx = appendMultiIlike(parseMultiSpecValues(query.generation), GEN_FIELD, conditions, params, idx);
  }
  if (query.ram && query.ram !== 'All') {
    idx = appendMultiIlike(parseMultiSpecValues(query.ram), RAM_FIELD, conditions, params, idx);
  }
  if ((query.storage || query.ssd) && (query.storage || query.ssd) !== 'All') {
    idx = appendMultiIlike(
      parseMultiSpecValues(query.storage || query.ssd),
      STORAGE_FIELD,
      conditions,
      params,
      idx
    );
  }

  const bucket = query.current_stage || query.bucket || query.kpi;
  if (bucket && bucket !== 'All' && bucket !== 'total') {
    conditions.push(`(${BUCKET_SQL}) = $${idx}`);
    params.push(String(bucket));
    idx += 1;
  }

  if (query.current_status && query.current_status !== 'All') {
    const statuses = parseMultiSpecValues(query.current_status).filter((v) => v !== 'All');
    if (statuses.length) {
      conditions.push(`s.inventory_status = ANY($${idx}::text[])`);
      params.push(statuses);
      idx += 1;
    }
  }

  if (query.technician || query.technician_id || query.user_id) {
    const uid = parseInt(query.technician_id || query.user_id || query.technician, 10);
    if (Number.isInteger(uid)) {
      conditions.push(`t.assigned_user_id = $${idx}`);
      params.push(uid);
      idx += 1;
    } else if (query.technician && query.technician !== 'All') {
      const names = parseMultiSpecValues(query.technician).filter((v) => v !== 'All');
      if (names.length) {
        conditions.push(`tech.name = ANY($${idx}::text[])`);
        params.push(names);
        idx += 1;
      }
    }
  }

  if (query.vendor || query.vendor_id) {
    const vid = parseInt(query.vendor_id || query.vendor, 10);
    if (Number.isInteger(vid)) {
      conditions.push(`v.vendor_id = $${idx}`);
      params.push(vid);
      idx += 1;
    } else if (query.vendor && query.vendor !== 'All') {
      const names = parseMultiSpecValues(query.vendor).filter((v) => v !== 'All');
      if (names.length) {
        conditions.push(`${vendorDisplaySql()} = ANY($${idx}::text[])`);
        params.push(names);
        idx += 1;
      }
    }
  }

  return {
    whereSql: `WHERE ${conditions.join(' AND ')}`,
    params,
    idx,
  };
}

async function getWarehouseSummary(query = {}) {
  // KPI tiles must stay comparable under brand/search/etc. Bucket/stage drill-down
  // is listing-only — including it here zeroes every other tile and shrinks Total.
  const summaryQuery = { ...query };
  delete summaryQuery.current_stage;
  delete summaryQuery.bucket;
  delete summaryQuery.kpi;
  const { whereSql, params } = buildWarehouseFilters(summaryQuery);
  const r = await pool.query(
    `SELECT (${BUCKET_SQL}) AS bucket, COUNT(*)::int AS cnt
       ${BASE_FROM_SQL}
       ${whereSql}
      GROUP BY 1`,
    params
  );

  const counts = {
    total: 0,
    qc1: 0,
    qc2: 0,
    diagnosis: 0,
    hardware_software: 0,
    final_testing: 0,
    ready_to_rent_sell: 0,
    out_for_repair: 0,
    dead_scrapped: 0,
    pending_inventory: 0,
    other: 0,
  };
  for (const row of r.rows) {
    const key = row.bucket || 'other';
    const n = Number(row.cnt) || 0;
    counts.total += n;
    if (Object.prototype.hasOwnProperty.call(counts, key)) counts[key] += n;
    else counts.other += n;
  }
  return counts;
}

async function getWarehouseLaptopListing(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 25));
  const offset = (page - 1) * limit;
  const { whereSql, params, idx } = buildWarehouseFilters(query);

  const countR = await pool.query(
    `SELECT COUNT(*)::int AS total ${BASE_FROM_SQL} ${whereSql}`,
    params
  );
  const total = countR.rows[0]?.total || 0;

  const listR = await pool.query(
    `SELECT
        s.serial_id,
        s.serial_number AS raw_serial_number,
        s.inventory_asset_code,
        s.extra,
        s.grn_id,
        s.qc_status,
        s.remark,
        s.inventory_status,
        s.created_at AS serial_created_at,
        s.updated_at AS serial_updated_at,
        po.po_id,
        po.purchase_order_number,
        po.purchase_order_type,
        po.line_items,
        po.product_details_legacy_ids,
        po.vendor_id,
        v.business_name,
        v.first_name || ' ' || v.last_name AS vendor_name,
        ${TTSPL_FIELD} AS ttspl_number,
        ${SERIAL_FIELD} AS serial_number,
        ${BRAND_FIELD} AS brand,
        ${MODEL_FIELD} AS model,
        ${PROC_FIELD} AS processor,
        ${GEN_FIELD} AS generation,
        ${RAM_FIELD} AS ram,
        ${STORAGE_FIELD} AS storage,
        ${GRAPHICS_FIELD} AS graphics,
        ${SCREEN_FIELD} AS screen_size,
        s.inventory_status AS current_status,
        COALESCE(
          st.stage_name,
          CASE
            WHEN pa.production_asset_id IS NOT NULL THEN 'Pending Inventory'
            WHEN ${READY_TO_RENT_SELL_SQL} THEN 'Ready to Rent/Sell'
            WHEN s.inventory_status = 'scrapped' THEN 'Dead/Scrapped'
            WHEN ${OUT_FOR_REPAIR_SQL} THEN 'Out for Repair'
            ELSE NULL
          END
        ) AS current_stage,
        (${BUCKET_SQL}) AS bucket,
        tech.name AS technician,
        qc.name AS qc_user,
        ${vendorDisplaySql()} AS vendor,
        t.ticket_id,
        t.status AS ticket_status
       ${BASE_FROM_SQL}
       ${whereSql}
      ORDER BY ${TTSPL_FIELD} NULLS LAST, s.serial_id
      LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset]
  );

  const enriched = await enrichSerialRowsBatch(pool, listR.rows);
  const data = listR.rows.map((row, i) => {
    const fromInv = enriched[i]?.item_description || {};
    const item_description = {
      brand: row.brand || fromInv.brand || '',
      model: row.model || fromInv.model || '',
      screen_size: row.screen_size || fromInv.screen_size || '',
      processor: row.processor || fromInv.processor || '',
      generation: row.generation || fromInv.generation || '',
      ram: row.ram || fromInv.ram || '',
      storage: row.storage || fromInv.storage || '',
      gpu: row.graphics || fromInv.gpu || '',
    };
    return {
      serial_id: row.serial_id,
      ttspl_number: row.ttspl_number,
      serial_number: row.serial_number,
      brand: item_description.brand,
      model: item_description.model,
      processor: item_description.processor,
      generation: item_description.generation,
      ram: item_description.ram,
      storage: item_description.storage,
      graphics: item_description.gpu,
      screen_size: item_description.screen_size,
      item_description,
      current_status: row.current_status,
      current_stage: row.current_stage,
      bucket: row.bucket,
      technician: row.technician,
      qc_user: row.qc_user,
      vendor: row.vendor,
      ticket_id: row.ticket_id,
      ticket_status: row.ticket_status,
    };
  });

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

async function getWarehouseFilterOptions() {
  const baseWhere = `
    WHERE s.deleted_at IS NULL
      AND (
        NOT (${deployedStatusFilterSql('s.inventory_status', '$1')})
        OR (${READY_TO_RENT_SELL_SQL})
      )
  `;
  const deployed = [...DEPLOYED_WITH_CUSTOMER_STATUSES];

  const [brands, models, processors, generations, rams, storages, statuses, technicians, vendors] = await Promise.all([
    pool.query(
      `SELECT DISTINCT ${BRAND_FIELD} AS v ${BASE_FROM_SQL} ${baseWhere}
        AND ${BRAND_FIELD} <> '' ORDER BY 1 LIMIT 500`,
      [deployed]
    ),
    pool.query(
      `SELECT DISTINCT ${MODEL_FIELD} AS v ${BASE_FROM_SQL} ${baseWhere}
        AND ${MODEL_FIELD} <> '' ORDER BY 1 LIMIT 500`,
      [deployed]
    ),
    pool.query(
      `SELECT DISTINCT ${PROC_FIELD} AS v ${BASE_FROM_SQL} ${baseWhere}
        AND ${PROC_FIELD} <> '' ORDER BY 1 LIMIT 500`,
      [deployed]
    ),
    pool.query(
      `SELECT DISTINCT ${GEN_FIELD} AS v ${BASE_FROM_SQL} ${baseWhere}
        AND ${GEN_FIELD} <> '' ORDER BY 1 LIMIT 200`,
      [deployed]
    ),
    pool.query(
      `SELECT DISTINCT ${RAM_FIELD} AS v ${BASE_FROM_SQL} ${baseWhere}
        AND ${RAM_FIELD} <> '' ORDER BY 1 LIMIT 100`,
      [deployed]
    ),
    pool.query(
      `SELECT DISTINCT ${STORAGE_FIELD} AS v ${BASE_FROM_SQL} ${baseWhere}
        AND ${STORAGE_FIELD} <> '' ORDER BY 1 LIMIT 100`,
      [deployed]
    ),
    pool.query(
      `SELECT DISTINCT s.inventory_status AS v
         FROM vendor_serial_numbers s
        WHERE s.deleted_at IS NULL
          AND s.inventory_status IS NOT NULL
          AND NOT (${deployedStatusFilterSql('s.inventory_status', '$1')})
        ORDER BY 1`,
      [deployed]
    ),
    pool.query(
      `SELECT DISTINCT tech.user_id, tech.name
         ${BASE_FROM_SQL} ${baseWhere}
          AND tech.user_id IS NOT NULL
        ORDER BY tech.name`,
      [deployed]
    ),
    pool.query(
      `SELECT DISTINCT v.vendor_id,
              ${vendorDisplaySql()} AS name
         FROM vendors v
        WHERE v.deleted_at IS NULL
          AND ${vendorDisplaySql()} IS NOT NULL
        ORDER BY 2
        LIMIT 500`
    ),
  ]);

  const mapVals = (rows) => rows.map((r) => r.v).filter(Boolean);

  return {
    brands: mapVals(brands.rows),
    models: mapVals(models.rows),
    processors: [...PROCESSOR_BUCKETS_SHORT, ...mapVals(processors.rows).filter((p) => !PROCESSOR_BUCKETS_SHORT.includes(p))],
    generations: mapVals(generations.rows),
    rams: mapVals(rams.rows),
    storages: mapVals(storages.rows),
    statuses: mapVals(statuses.rows),
    stages: [
      { key: 'qc1', label: 'QC1' },
      { key: 'qc2', label: 'QC2' },
      { key: 'diagnosis', label: 'Diagnosis' },
      { key: 'hardware_software', label: 'Hardware & Software' },
      { key: 'final_testing', label: 'Final Testing' },
      { key: 'ready_to_rent_sell', label: 'Ready to Rent/Sell' },
      { key: 'out_for_repair', label: 'Out for Repair' },
      { key: 'dead_scrapped', label: 'Dead/Scrapped' },
      { key: 'pending_inventory', label: 'Pending Inventory' },
      { key: 'other', label: 'Other' },
    ],
    technicians: technicians.rows.map((r) => ({ user_id: r.user_id, name: r.name })),
    vendors: vendors.rows.map((r) => ({ vendor_id: r.vendor_id, name: r.name })),
    report_stages: REPORT_STAGES,
  };
}

module.exports = {
  buildWarehouseFilters,
  getWarehouseSummary,
  getWarehouseLaptopListing,
  getWarehouseFilterOptions,
  DEPLOYED_WITH_CUSTOMER_STATUSES,
  BUCKET_SQL,
};
