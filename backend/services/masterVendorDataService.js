/**
 * Master Vendor Data — laptops purchased via Vendor PO in a purchase-date window,
 * then their current inventory / customer / warehouse stage.
 * Reuses Master Data joins, filters, sale/rental SQL, and row mapping.
 */
const pool = require('../config/db');
const XLSX = require('xlsx');
const { appendDateRangeClauses, parseCsvQuery, resolveMasterDateRange } = require('../utils/dateRangeFilter');
const {
  FROM_SQL,
  buildMasterFilters,
  mapLaptopRow,
  SQL_IS_SALE,
  SQL_IS_RENTAL,
  CUSTOMER_STATUSES,
  formatPurchaseOrderType,
} = require('./masterDataDashboardService');

const KNOWN_PURCHASE_TYPES = ['rental_purchase', 'rent_to_own', 'direct_purchase'];
const SQL_IS_RENTAL_PURCHASE_PO = `LOWER(COALESCE(p.purchase_order_type, '')) = 'rental_purchase'`;
/** Vendor-repair replacement intake — linked to original TTSPL, not a new purchase. */
const SQL_IS_VENDOR_REPAIR_REPLACEMENT = `(
  LOWER(COALESCE(s.extra->>'source', '')) = 'vendor_repair_replacement'
  OR LOWER(COALESCE(s.extra->>'asset_tag', '')) = 'replacement'
)`;
const VENDOR_REPLACEMENT_CHAIN_LATERAL = `
  LEFT JOIN LATERAL (
    WITH RECURSIVE rep_chain AS (
      SELECT
        rep.serial_id,
        rep.inventory_asset_code AS ttspl,
        1 AS depth
      FROM vendor_serial_numbers rep
      WHERE rep.deleted_at IS NULL
        AND (
          LOWER(COALESCE(rep.extra->>'source', '')) = 'vendor_repair_replacement'
          OR LOWER(COALESCE(rep.extra->>'asset_tag', '')) = 'replacement'
        )
        AND UPPER(TRIM(COALESCE(rep.extra->>'replaced_ttspl_id', rep.extra->>'replaced_ttspl', '')))
            = UPPER(TRIM(COALESCE(s.inventory_asset_code, '')))
      UNION ALL
      SELECT
        rep.serial_id,
        rep.inventory_asset_code AS ttspl,
        rc.depth + 1 AS depth
      FROM rep_chain rc
      JOIN vendor_serial_numbers rep ON rep.deleted_at IS NULL
        AND (
          LOWER(COALESCE(rep.extra->>'source', '')) = 'vendor_repair_replacement'
          OR LOWER(COALESCE(rep.extra->>'asset_tag', '')) = 'replacement'
        )
        AND UPPER(TRIM(COALESCE(rep.extra->>'replaced_ttspl_id', rep.extra->>'replaced_ttspl', '')))
            = UPPER(TRIM(rc.ttspl))
      WHERE rc.depth < 12
    )
    SELECT ttspl AS latest_replacement_ttspl
    FROM rep_chain
    ORDER BY depth DESC
    LIMIT 1
  ) vendor_rep_chain ON true
`;
const {
  appendColumnFilters,
  getColumnDistinctValues,
  columnKeys,
  getColumnDef,
  COLUMNS,
} = require('./vendorMasterColumnFilters');

const CUSTOMER_SQL = CUSTOMER_STATUSES.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ');

const WAREHOUSE_BUCKET_SQL = `
  CASE
    WHEN s.inventory_status IN (${CUSTOMER_SQL}) THEN
      CASE WHEN ${SQL_IS_SALE} THEN 'sold' ELSE 'rental' END
    WHEN s.inventory_status = 'scrapped' THEN 'dead_scrapped'
    WHEN vr.on_vendor_repair IS NOT NULL
      OR s.inventory_status IN ('in_repair', 'out_for_repare')
      THEN 'out_for_repair'
    WHEN s.inventory_status = 'in_stock'
      AND LOWER(COALESCE(s.qc_status, s.extra->>'status', '')) = 'passed'
      AND ${SQL_IS_SALE} THEN 'ready_to_sell'
    WHEN s.inventory_status = 'in_stock'
      AND LOWER(COALESCE(s.qc_status, s.extra->>'status', '')) = 'passed'
      THEN 'ready_to_rent'
    WHEN active_ticket.stage_name = 'QC1' THEN 'qc1'
    WHEN active_ticket.stage_name = 'QC2' THEN 'qc2'
    WHEN active_ticket.stage_name IN ('Diagnosis', 'Chip Level Repair') THEN 'diagnosis_hardware'
    WHEN active_ticket.stage_name IN ('Assembly & Software') THEN 'diagnosis_software'
    WHEN active_ticket.stage_name = 'Final Testing' THEN 'final_testing'
    WHEN active_ticket.stage_name = 'Dispatch QC' THEN 'dispatch'
    ELSE 'other'
  END
`;

const WAREHOUSE_STAGE_KEYS = [
  'qc1', 'qc2', 'diagnosis_hardware', 'diagnosis_software', 'final_testing',
  'ready_to_rent', 'ready_to_sell', 'dead_scrapped', 'other',
];

function purchaseDateInput(query = {}) {
  const hasPrefixed = String(query.purchase_date_mode || '').trim()
    || String(query.purchase_month || '').trim()
    || String(query.purchase_date_from || '').trim()
    || String(query.purchase_date_to || '').trim();
  if (hasPrefixed) {
    return {
      date_mode: query.purchase_date_mode,
      dateMode: query.purchase_date_mode,
      month: query.purchase_month,
      date_from: query.purchase_date_from,
      dateFrom: query.purchase_date_from,
      date_to: query.purchase_date_to,
      dateTo: query.purchase_date_to,
    };
  }
  return {
    date_mode: query.date_mode,
    dateMode: query.dateMode,
    month: query.month,
    date_from: query.date_from,
    dateFrom: query.dateFrom,
    date_to: query.date_to,
    dateTo: query.dateTo,
  };
}

function activityDateInput(query = {}) {
  return {
    date_mode: query.activity_date_mode,
    dateMode: query.activity_date_mode,
    month: query.activity_month,
    date_from: query.activity_date_from,
    dateFrom: query.activity_date_from,
    date_to: query.activity_date_to,
    dateTo: query.activity_date_to,
  };
}

function scopedQuery(query = {}) {
  return {
    ...query,
    ...purchaseDateInput(query),
    date_basis: 'purchase',
    apply_vendor_po_exclusion: query.apply_vendor_po_exclusion == null ? '1' : query.apply_vendor_po_exclusion,
    from_vendor: '1',
  };
}

/** Laptops purchased in the Purchase Date window (unique physical serials). */
function buildPurchaseScopedFilters(query = {}, { includeReplacements = false } = {}) {
  const base = buildMasterFilters({
    ...stripAllDateFields(query),
    ...purchaseDateInput(query),
    date_basis: 'purchase',
    apply_vendor_po_exclusion: query.apply_vendor_po_exclusion == null ? '1' : query.apply_vendor_po_exclusion,
    from_vendor: '1',
  });
  if (!includeReplacements) appendExcludeVendorRepairReplacements(base);
  return base;
}

/** Sale completion date — delivery preferred, else dispatch. */
function soldDateExpr() {
  return 'COALESCE(s.delivered_at, s.dispatched_at)';
}

/** Rental deployment date — delivery, rent start, or dispatch. */
function rentalDateExpr() {
  return 'COALESCE(s.delivered_at, s.rent_start_date, s.dispatched_at)';
}

function stripAllDateFields(query = {}) {
  const next = { ...query };
  [
    'date_mode', 'dateMode', 'month', 'date_from', 'dateFrom', 'date_to', 'dateTo',
    'date_basis', 'dateBasis',
    'purchase_date_mode', 'purchase_month', 'purchase_date_from', 'purchase_date_to',
    'activity_date_mode', 'activity_month', 'activity_date_from', 'activity_date_to',
  ].forEach((k) => {
    delete next[k];
  });
  return next;
}

function applyExprDateRangeFilter(base, dateInput = {}, dateExpr) {
  const dateRange = resolveMasterDateRange(dateInput);
  const hasRanges = Array.isArray(dateRange.ranges) && dateRange.ranges.length > 0;
  if (!hasRanges && !dateRange.dateFrom && !dateRange.dateTo) return base;

  const appendOneRange = (range) => {
    const parts = appendDateRangeClauses({
      expr: dateExpr,
      dateFrom: range?.dateFrom,
      dateTo: range?.dateTo,
      params: base.params,
      timezone: 'Asia/Kolkata',
    });
    return parts.length ? `(${parts.join(' AND ')})` : null;
  };

  if (hasRanges && dateRange.ranges.length > 1) {
    const orParts = dateRange.ranges.map(appendOneRange).filter(Boolean);
    if (orParts.length) {
      base.whereSql = `${base.whereSql} AND (${orParts.join(' OR ')})`;
    }
  } else {
    const parts = appendDateRangeClauses({
      expr: dateExpr,
      dateFrom: dateRange.dateFrom,
      dateTo: dateRange.dateTo,
      params: base.params,
      timezone: 'Asia/Kolkata',
    });
    if (parts.length) base.whereSql = `${base.whereSql} AND ${parts.join(' AND ')}`;
  }
  base.whereSql = `${base.whereSql} AND ${dateExpr} IS NOT NULL`;
  return base;
}

/** Sold laptops: purchase cohort + optional Sale & Rental Date on sold/dispatch date. */
function buildSoldVendorFilters(query = {}, { excludeColumn } = {}) {
  const base = buildPurchaseScopedFilters(query);
  base.whereSql = `${base.whereSql} AND (${usageSql()}) = 'sold'`;
  applyExprDateRangeFilter(base, activityDateInput(query), soldDateExpr());
  return appendColumnFilters(base, query, {
    excludeColumn,
    locationLabelSql: locationLabelSql(),
  });
}

/** Rented laptops: purchase cohort + optional Sale & Rental Date on rent/dispatch date. */
function buildRentalVendorFilters(query = {}, { excludeColumn } = {}) {
  const base = buildPurchaseScopedFilters(query);
  base.whereSql = `${base.whereSql} AND (${usageSql()}) = 'rental'`;
  applyExprDateRangeFilter(base, activityDateInput(query), rentalDateExpr());
  return appendColumnFilters(base, query, {
    excludeColumn,
    locationLabelSql: locationLabelSql(),
  });
}

function usesSoldDateFilters(query = {}) {
  return parseCsvQuery(query.usage_bucket).includes('sold');
}

function usesRentalDateFilters(query = {}) {
  return parseCsvQuery(query.usage_bucket).includes('rental');
}

function usesReplacementIntakeList(query = {}) {
  return String(query.intake_type || query.record_type || '').trim().toLowerCase() === 'replacement';
}

/** Vendor-repair replacement intakes in the Purchase Date window (excluded from Total Purchased). */
function buildReplacementIntakeFilters(query = {}, { excludeColumn } = {}) {
  const base = buildPurchaseScopedFilters(query, { includeReplacements: true });
  base.whereSql = `${base.whereSql} AND (${SQL_IS_VENDOR_REPAIR_REPLACEMENT})`;
  return appendColumnFilters(base, query, {
    excludeColumn,
    locationLabelSql: locationLabelSql(),
  });
}

function rentalLifecycleClause(lifecycle) {
  const lc = String(lifecycle || '').trim().toLowerCase();
  if (lc === 'rented') {
    return `(${SQL_IS_RENTAL_PURCHASE_PO} AND ${usageSql()} = 'rental')`;
  }
  if (lc === 'returned') {
    return `(${SQL_IS_RENTAL_PURCHASE_PO} AND s.inventory_status = 'returned')`;
  }
  if (lc === 'warehouse') {
    return `(${SQL_IS_RENTAL_PURCHASE_PO} AND ${usageSql()} <> 'rental' AND s.inventory_status <> 'returned')`;
  }
  return null;
}

function buildVendorMasterFilters(query = {}, { excludeColumn } = {}) {
  if (usesReplacementIntakeList(query)) {
    return buildReplacementIntakeFilters(query, { excludeColumn });
  }
  if (usesSoldDateFilters(query)) {
    return buildSoldVendorFilters(query, { excludeColumn });
  }
  if (usesRentalDateFilters(query)) {
    return buildRentalVendorFilters(query, { excludeColumn });
  }
  const base = buildPurchaseScopedFilters(query, { includeReplacements: false });
  const usageBuckets = parseCsvQuery(query.usage_bucket);
  if (usageBuckets.length) {
    base.params.push(usageBuckets);
    const i = base.params.length;
    base.whereSql = `${base.whereSql} AND (${usageSql()}) = ANY($${i}::text[])`;
  }
  const buckets = parseCsvQuery(query.warehouse_bucket);
  if (buckets.length) {
    base.params.push(buckets);
    const i = base.params.length;
    base.whereSql = `${base.whereSql} AND (${WAREHOUSE_BUCKET_SQL}) = ANY($${i}::text[])`;
  }
  const rentalLife = rentalLifecycleClause(query.rental_lifecycle);
  if (rentalLife) {
    base.whereSql = `${base.whereSql} AND ${rentalLife}`;
  }
  return appendColumnFilters(base, query, {
    excludeColumn,
    locationLabelSql: locationLabelSql(),
  });
}

function rentalPurchaseScopeQuery(query = {}) {
  return {
    ...scopedQuery(query),
    status: '',
    location: '',
    stage: '',
    warehouse_bucket: '',
    rental_lifecycle: '',
    pricing_type: '',
  };
}

/** Physical laptop identity — same unit re-entering via GRN keeps history on #archived rows. */
function physicalSerialKeySql(alias = 's') {
  return `COALESCE(
    NULLIF(UPPER(TRIM(${alias}.extra->>'archived_serial_number')), ''),
    NULLIF(UPPER(TRIM(REGEXP_REPLACE(${alias}.serial_number, '#archived-[0-9]+$', '', 'i'))), ''),
    CONCAT('sid:', ${alias}.serial_id::text)
  )`;
}

function canonicalSerialOrderSql() {
  return `
    CASE WHEN ${SQL_IS_VENDOR_REPAIR_REPLACEMENT} THEN 1 ELSE 0 END,
    CASE WHEN s.serial_number ~* '#archived-[0-9]+$' THEN 1 ELSE 0 END,
    s.serial_id DESC
  `;
}

function appendExcludeVendorRepairReplacements(base) {
  base.whereSql = `${base.whereSql} AND NOT (${SQL_IS_VENDOR_REPAIR_REPLACEMENT})`;
  return base;
}

/** One row per physical serial — used for KPI counts (list still returns all transactions). */
function uniqueUnitsCountSql(base) {
  const physicalKey = physicalSerialKeySql();
  const canonicalOrder = canonicalSerialOrderSql();
  return `
    SELECT COUNT(*)::int AS unique_total FROM (
      SELECT DISTINCT ON (${physicalKey}) 1
      ${FROM_SQL}
      ${base.joinSql || ''}
      ${base.whereSql}
      ORDER BY ${physicalKey}, ${canonicalOrder}
    ) canonical_units
  `;
}

function usageSql() {
  return `
    CASE
      WHEN s.inventory_status IN (${CUSTOMER_SQL}) AND ${SQL_IS_SALE} THEN 'sold'
      WHEN s.inventory_status IN (${CUSTOMER_SQL}) THEN 'rental'
      WHEN vr.on_vendor_repair IS NOT NULL
        OR s.inventory_status IN ('in_repair', 'out_for_repare') THEN 'repair'
      ELSE 'warehouse'
    END
  `;
}

function locationLabelSql() {
  return `
    CASE
      WHEN s.inventory_status IN (${CUSTOMER_SQL}) THEN
        CONCAT('Customer - ', COALESCE(NULLIF(TRIM(COALESCE(c.company_name, c.name)), ''), 'Customer'))
      WHEN vr.on_vendor_repair IS NOT NULL
        OR s.inventory_status IN ('in_repair', 'out_for_repare') THEN 'Vendor Repair'
      WHEN s.inventory_status = 'scrapped' THEN 'Dead / Scrapped'
      WHEN s.inventory_status = 'in_stock'
        AND LOWER(COALESCE(s.qc_status, s.extra->>'status', '')) = 'passed'
        AND ${SQL_IS_SALE} THEN 'Ready to Sell'
      WHEN s.inventory_status = 'in_stock'
        AND LOWER(COALESCE(s.qc_status, s.extra->>'status', '')) = 'passed'
        THEN 'Ready to Rent'
      WHEN COALESCE(active_ticket.stage_name, '') <> '' THEN active_ticket.stage_name
      ELSE 'Warehouse'
    END
  `;
}

function emptyWarehouseStages() {
  return WAREHOUSE_STAGE_KEYS.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
}

function mapVendorMasterRow(row) {
  const base = mapLaptopRow(row);
  const extra = row.extra && typeof row.extra === 'object' ? row.extra : {};
  const isReplacementIntake = String(extra.source || '').toLowerCase() === 'vendor_repair_replacement'
    || String(extra.asset_tag || '').toLowerCase() === 'replacement';
  const replacedTtspl = extra.replaced_ttspl_id || extra.replaced_ttspl || null;
  const originalTtspl = base.ttspl_id || row.inventory_asset_code || null;
  const latestReplacement = row.latest_replacement_ttspl || null;
  let ttsplDisplay = originalTtspl;
  if (isReplacementIntake && replacedTtspl && originalTtspl) {
    ttsplDisplay = `${replacedTtspl} -> ${originalTtspl}`;
  } else if (originalTtspl && latestReplacement && latestReplacement !== originalTtspl) {
    ttsplDisplay = `${originalTtspl} -> ${latestReplacement}`;
  }
  const purchaseRate = row.purchase_rate != null && row.purchase_rate !== ''
    ? Number(row.purchase_rate)
    : (base.vendor_price_type === 'purchase' ? base.vendor_purchase_price : null);
  const usage = row.usage_bucket || null;
  const withCustomer = usage === 'sold' || usage === 'rental';
  return {
    ...base,
    ttspl_id: originalTtspl,
    ttspl_display: ttsplDisplay,
    latest_replacement_ttspl: latestReplacement,
    replaced_ttspl_id: replacedTtspl,
    is_replacement_intake: isReplacementIntake,
    purchase_date: row.purchase_order_date || null,
    purchase_rate: purchaseRate,
    sold_date: row.delivered_at || row.dispatched_at || null,
    last_movement_date: row.delivered_at || row.dispatched_at || row.updated_at || null,
    location_label: row.location_label || base.current_location,
    warehouse_bucket: row.warehouse_bucket || null,
    usage_bucket: usage,
    sale_price: usage === 'sold' ? (base.sale_price ?? (row.so_rate != null ? Number(row.so_rate) : null)) : base.sale_price,
    customer_monthly_rate: usage === 'rental'
      ? (base.customer_monthly_rate != null
        ? base.customer_monthly_rate
        : (Number(row.rent_monthly_rate || row.so_rate || 0) || null))
      : base.customer_monthly_rate,
    customer_id: withCustomer ? (row.current_customer_id || base.customer_id) : base.customer_id,
    customer_name: withCustomer ? (row.customer_name || base.customer_name) : base.customer_name,
    sales_order_number: withCustomer ? (row.sales_order_number || base.sales_order_number) : base.sales_order_number,
    delivery_challan_number: withCustomer
      ? (row.current_dc_number || row.sos_dc_number || base.delivery_challan_number)
      : base.delivery_challan_number,
  };
}

const LIST_SELECT = `
  s.serial_id, s.serial_number, s.inventory_asset_code, s.extra, s.inventory_status,
  s.current_customer_id, s.current_dc_number, s.current_entity, s.updated_at,
  s.rent_monthly_rate, s.rent_start_date, s.delivered_at, s.dispatched_at, s.grn_id, s.qc_status,
  p.po_id, p.purchase_order_number, p.purchase_order_type, p.vendor_id, p.purchase_order_date,
  COALESCE(v.business_name, TRIM(CONCAT(COALESCE(v.first_name,''), ' ', COALESCE(v.last_name,'')))) AS vendor_name,
  COALESCE(c.company_name, c.name) AS customer_name,
  active_ticket.ticket_id AS active_floor_ticket_id,
  active_ticket.stage_name AS ticket_stage_name,
  sos.sales_order_number, sos.dc_number AS sos_dc_number, sos.so_rate, sos.quotation_type,
  vr.on_vendor_repair,
  vpd.purchase_rate,
  vpd.monthly_rental_amount,
  (${WAREHOUSE_BUCKET_SQL}) AS warehouse_bucket,
  (${usageSql()}) AS usage_bucket,
  (${locationLabelSql()}) AS location_label,
  vendor_rep_chain.latest_replacement_ttspl
`;

function purchaseTypeOption(value) {
  if (value === 'rental_purchase') return { value, label: 'Rental Purchase' };
  return { value, label: formatPurchaseOrderType(value) || value };
}

async function getOverview(query = {}) {
  const base = buildVendorMasterFilters(query);
  const soldBase = buildSoldVendorFilters(query);
  const rentalActivityBase = buildRentalVendorFilters(query);
  const optionFilters = buildMasterFilters({
    ...scopedQuery(query),
    vendor_id: '',
    warehouse_bucket: '',
    customer_id: '',
    purchase_type: '',
    purchase_order_type: '',
  });
  const customerOptionFilters = buildMasterFilters({
    ...scopedQuery(query),
    customer_id: '',
    warehouse_bucket: '',
    rental_lifecycle: '',
  });
  const rentalScope = buildVendorMasterFilters(rentalPurchaseScopeQuery(query));
  const replacementKpiBase = buildReplacementIntakeFilters(query);
  const usage = usageSql();
  const physicalKey = physicalSerialKeySql();
  const canonicalOrder = canonicalSerialOrderSql();
  const [kpiRes, soldKpiRes, rentalActivityKpiRes, replacementKpiRes, vendorRes, soldVendorRes, rentalVendorRes, optionRes, customerRes, purchaseTypeRes, rentalKpiRes] = await Promise.all([
    pool.query(
      `SELECT
          COUNT(*)::int AS total_purchased,
          COALESCE(SUM(COALESCE(purchase_rate, 0)), 0)::numeric AS total_purchase_value,
          COUNT(*) FILTER (WHERE usage_bucket = 'warehouse')::int AS warehouse_count,
          COUNT(*) FILTER (WHERE inventory_status = 'returned')::int AS returned_count,
          COUNT(*) FILTER (WHERE latest_replacement_ttspl IS NOT NULL)::int AS replacement_linked_count,
          COUNT(*) FILTER (WHERE usage_bucket = 'repair')::int AS out_for_repair_count,
          COUNT(*) FILTER (WHERE warehouse_bucket = 'qc1')::int AS qc1,
          COUNT(*) FILTER (WHERE warehouse_bucket = 'qc2')::int AS qc2,
          COUNT(*) FILTER (WHERE warehouse_bucket = 'diagnosis_hardware')::int AS diagnosis_hardware,
          COUNT(*) FILTER (WHERE warehouse_bucket = 'diagnosis_software')::int AS diagnosis_software,
          COUNT(*) FILTER (WHERE warehouse_bucket = 'final_testing')::int AS final_testing,
          COUNT(*) FILTER (WHERE warehouse_bucket = 'ready_to_rent')::int AS ready_to_rent,
          COUNT(*) FILTER (WHERE warehouse_bucket = 'ready_to_sell')::int AS ready_to_sell,
          COUNT(*) FILTER (WHERE warehouse_bucket = 'dead_scrapped')::int AS dead_scrapped,
          COUNT(*) FILTER (WHERE warehouse_bucket = 'other' AND usage_bucket = 'warehouse')::int AS other
       FROM (
         SELECT DISTINCT ON (${physicalKey})
           s.inventory_status,
           COALESCE(vpd.purchase_rate, 0) AS purchase_rate,
           COALESCE(s.rent_monthly_rate, sos.so_rate, 0) AS rent_monthly_rate,
           COALESCE(sos.so_rate, 0) AS so_rate,
           (${usage}) AS usage_bucket,
           (${WAREHOUSE_BUCKET_SQL}) AS warehouse_bucket,
           vendor_rep_chain.latest_replacement_ttspl
         ${FROM_SQL}
         ${VENDOR_REPLACEMENT_CHAIN_LATERAL}
         ${base.joinSql || ''}
         ${base.whereSql}
         ORDER BY ${physicalKey}, ${canonicalOrder}
       ) canonical_units`,
      base.params
    ),
    pool.query(
      `SELECT
          COUNT(*)::int AS sold_count,
          COALESCE(SUM(COALESCE(so_rate, 0)), 0)::numeric AS total_sale_value
       FROM (
         SELECT DISTINCT ON (${physicalKey})
           COALESCE(sos.so_rate, 0) AS so_rate
         ${FROM_SQL}
         ${soldBase.joinSql || ''}
         ${soldBase.whereSql}
         ORDER BY ${physicalKey}, ${canonicalOrder}
       ) canonical_sold`,
      soldBase.params
    ),
    pool.query(
      `SELECT
          COUNT(*)::int AS rental_count,
          COALESCE(SUM(COALESCE(rent_monthly_rate, so_rate, 0)) FILTER (
            WHERE inventory_status IN ('rented', 'on_demo', 'reserved', 'in_transit')
          ), 0)::numeric AS total_monthly_rental_value
       FROM (
         SELECT DISTINCT ON (${physicalKey})
           s.inventory_status,
           COALESCE(s.rent_monthly_rate, sos.so_rate, 0) AS rent_monthly_rate,
           COALESCE(sos.so_rate, 0) AS so_rate
         ${FROM_SQL}
         ${rentalActivityBase.joinSql || ''}
         ${rentalActivityBase.whereSql}
         ORDER BY ${physicalKey}, ${canonicalOrder}
       ) canonical_rental_activity`,
      rentalActivityBase.params
    ),
    pool.query(
      `SELECT COUNT(*)::int AS replacement_count
       ${FROM_SQL}
       ${replacementKpiBase.joinSql || ''}
       ${replacementKpiBase.whereSql}`,
      replacementKpiBase.params
    ),
    pool.query(
      `SELECT
          vendor_id,
          vendor_name,
          COUNT(*)::int AS purchased_qty,
          COALESCE(SUM(COALESCE(purchase_rate, 0)), 0)::numeric AS purchase_value,
          COUNT(*) FILTER (WHERE usage_bucket = 'warehouse')::int AS warehouse_qty,
          COUNT(*) FILTER (WHERE usage_bucket = 'repair')::int AS repair_qty
       FROM (
         SELECT DISTINCT ON (${physicalKey}, p.vendor_id)
           p.vendor_id,
           COALESCE(v.business_name, TRIM(CONCAT(COALESCE(v.first_name,''), ' ', COALESCE(v.last_name,'')))) AS vendor_name,
           s.inventory_status,
           COALESCE(vpd.purchase_rate, 0) AS purchase_rate,
           (${usage}) AS usage_bucket
         ${FROM_SQL}
         ${base.joinSql || ''}
         ${base.whereSql}
           AND p.vendor_id IS NOT NULL
         ORDER BY ${physicalKey}, p.vendor_id, ${canonicalOrder}
       ) canonical_vendor
       GROUP BY vendor_id, vendor_name
       ORDER BY purchased_qty DESC, vendor_name ASC
       LIMIT 300`,
      base.params
    ),
    pool.query(
      `SELECT
          vendor_id,
          COUNT(*)::int AS sold_qty,
          COALESCE(SUM(COALESCE(so_rate, 0)), 0)::numeric AS sale_value
       FROM (
         SELECT DISTINCT ON (${physicalKey}, p.vendor_id)
           p.vendor_id,
           COALESCE(sos.so_rate, 0) AS so_rate
         ${FROM_SQL}
         ${soldBase.joinSql || ''}
         ${soldBase.whereSql}
           AND p.vendor_id IS NOT NULL
         ORDER BY ${physicalKey}, p.vendor_id, ${canonicalOrder}
       ) canonical_sold_vendor
       GROUP BY vendor_id`,
      soldBase.params
    ),
    pool.query(
      `SELECT
          vendor_id,
          COUNT(*)::int AS rental_qty,
          COALESCE(SUM(COALESCE(rent_monthly_rate, so_rate, 0)) FILTER (
            WHERE inventory_status IN ('rented', 'on_demo', 'reserved', 'in_transit')
          ), 0)::numeric AS monthly_rental_value
       FROM (
         SELECT DISTINCT ON (${physicalKey}, p.vendor_id)
           p.vendor_id,
           s.inventory_status,
           COALESCE(s.rent_monthly_rate, sos.so_rate, 0) AS rent_monthly_rate,
           COALESCE(sos.so_rate, 0) AS so_rate
         ${FROM_SQL}
         ${rentalActivityBase.joinSql || ''}
         ${rentalActivityBase.whereSql}
           AND p.vendor_id IS NOT NULL
         ORDER BY ${physicalKey}, p.vendor_id, ${canonicalOrder}
       ) canonical_rental_vendor
       GROUP BY vendor_id`,
      rentalActivityBase.params
    ),
    pool.query(
      `SELECT DISTINCT
          p.vendor_id,
          COALESCE(v.business_name, TRIM(CONCAT(COALESCE(v.first_name,''), ' ', COALESCE(v.last_name,'')))) AS vendor_name
       ${FROM_SQL}
       ${optionFilters.joinSql || ''}
       ${optionFilters.whereSql}
         AND p.vendor_id IS NOT NULL
       ORDER BY vendor_name ASC
       LIMIT 400`,
      optionFilters.params
    ).catch(() => ({ rows: [] })),
    pool.query(
      `SELECT DISTINCT
          s.current_customer_id AS customer_id,
          COALESCE(c.company_name, c.name) AS customer_name
       ${FROM_SQL}
       ${customerOptionFilters.joinSql || ''}
       ${customerOptionFilters.whereSql}
         AND s.current_customer_id IS NOT NULL
       ORDER BY customer_name ASC
       LIMIT 400`,
      customerOptionFilters.params
    ).catch(() => ({ rows: [] })),
    pool.query(
      `SELECT DISTINCT LOWER(COALESCE(p.purchase_order_type, '')) AS purchase_type
       ${FROM_SQL}
       ${optionFilters.joinSql || ''}
       ${optionFilters.whereSql}
         AND COALESCE(p.purchase_order_type, '') <> ''
       ORDER BY 1`,
      optionFilters.params
    ).catch(() => ({ rows: [] })),
    pool.query(
      `SELECT
          COUNT(*) FILTER (WHERE is_rental_purchase_po)::int AS rental_purchase_total,
          COUNT(*) FILTER (WHERE is_rental_purchase_po AND usage_bucket = 'rental')::int AS rental_purchase_rented,
          COUNT(*) FILTER (WHERE is_rental_purchase_po AND inventory_status = 'returned')::int AS rental_purchase_returned
       FROM (
         SELECT DISTINCT ON (${physicalKey})
           s.inventory_status,
           (${usage}) AS usage_bucket,
           (${SQL_IS_RENTAL_PURCHASE_PO}) AS is_rental_purchase_po
         ${FROM_SQL}
         ${rentalScope.joinSql || ''}
         ${rentalScope.whereSql}
         ORDER BY ${physicalKey}, ${canonicalOrder}
       ) canonical_rental`,
      rentalScope.params
    ).catch(() => ({ rows: [{}] })),
  ]);

  const k = kpiRes.rows[0] || {};
  const soldK = soldKpiRes.rows[0] || {};
  const rentalK = rentalActivityKpiRes.rows[0] || {};
  const replacementK = replacementKpiRes.rows[0] || {};
  const soldByVendor = new Map(
    (soldVendorRes.rows || []).map((row) => [row.vendor_id, row])
  );
  const rentalByVendor = new Map(
    (rentalVendorRes.rows || []).map((row) => [row.vendor_id, row])
  );
  const warehouse_stages = emptyWarehouseStages();
  WAREHOUSE_STAGE_KEYS.forEach((key) => {
    warehouse_stages[key] = Number(k[key] || 0);
  });

  const vendors = vendorRes.rows.map((row) => {
    const soldRow = soldByVendor.get(row.vendor_id);
    const rentalRow = rentalByVendor.get(row.vendor_id);
    return {
    vendor_id: row.vendor_id,
    vendor_name: row.vendor_name,
    purchased_qty: Number(row.purchased_qty || 0),
    purchase_value: Number(row.purchase_value || 0),
    sold_qty: Number(soldRow?.sold_qty || 0),
    sale_value: Number(soldRow?.sale_value || 0),
    rental_qty: Number(rentalRow?.rental_qty || 0),
    monthly_rental_value: Number(rentalRow?.monthly_rental_value || 0),
    warehouse_qty: Number(row.warehouse_qty || 0),
    repair_qty: Number(row.repair_qty || 0),
    current_total: Number(row.purchased_qty || 0),
  };
  });

  const rk = rentalKpiRes.rows[0] || {};
  const rentalPurchaseTotal = Number(rk.rental_purchase_total || 0);
  const rentalPurchaseRented = Number(rk.rental_purchase_rented || 0);
  const rentalPurchaseReturned = Number(rk.rental_purchase_returned || 0);
  const rentalPurchaseWarehouse = Math.max(0, rentalPurchaseTotal - rentalPurchaseRented - rentalPurchaseReturned);

  const typeSet = new Set(KNOWN_PURCHASE_TYPES);
  (purchaseTypeRes.rows || []).forEach((r) => {
    if (r.purchase_type) typeSet.add(r.purchase_type);
  });

  return {
    kpis: {
      total_purchased: Number(k.total_purchased || 0),
      total_purchase_value: Number(k.total_purchase_value || 0),
      sold_count: Number(soldK.sold_count || 0),
      total_sale_value: Number(soldK.total_sale_value || 0),
      rental_count: Number(rentalK.rental_count || 0),
      total_monthly_rental_value: Number(rentalK.total_monthly_rental_value || 0),
      warehouse_count: Number(k.warehouse_count || 0),
      returned_count: Number(k.returned_count || 0),
      replacement_count: Number(replacementK.replacement_count || 0),
      replacement_linked_count: Number(k.replacement_linked_count || 0),
      out_for_repair_count: Number(k.out_for_repair_count || 0),
      warehouse_stages,
      rental_purchase_total: rentalPurchaseTotal,
      rental_purchase_rented: rentalPurchaseRented,
      rental_purchase_warehouse: rentalPurchaseWarehouse,
      rental_purchase_returned: rentalPurchaseReturned,
    },
    vendors,
    vendor_options: (optionRes.rows || []).map((r) => ({
      value: String(r.vendor_id),
      label: r.vendor_name || `#${r.vendor_id}`,
    })),
    customer_options: (customerRes.rows || []).map((r) => ({
      value: String(r.customer_id),
      label: r.customer_name || `#${r.customer_id}`,
    })),
    purchase_type_options: [...typeSet].map(purchaseTypeOption),
  };
}

async function getLaptopColumnValues(query = {}) {
  const column = String(query.column || '').trim();
  if (!column || !getColumnDef(column, locationLabelSql())) {
    return { column, values: [] };
  }
  const base = buildVendorMasterFilters(query, { excludeColumn: column });
  const values = await getColumnDistinctValues(pool, {
    fromSql: FROM_SQL,
    joinSql: base.joinSql,
    whereSql: base.whereSql,
    params: base.params,
  }, column, locationLabelSql());
  return { column, values };
}

async function listLaptops(query = {}) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 25, 1), 100);
  const offset = (page - 1) * limit;
  const soldList = usesSoldDateFilters(query);
  const rentalList = usesRentalDateFilters(query);
  const base = buildVendorMasterFilters(query);
  const orderBy = soldList
    ? `${soldDateExpr()} DESC NULLS LAST, s.serial_id DESC`
    : rentalList
      ? `${rentalDateExpr()} DESC NULLS LAST, s.serial_id DESC`
      : 'p.purchase_order_date DESC NULLS LAST, s.serial_id DESC';
  const listParams = [...base.params, limit, offset];
  const [countRes, uniqueRes, listRes] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total ${FROM_SQL} ${base.joinSql || ''} ${base.whereSql}`,
      base.params
    ),
    pool.query(uniqueUnitsCountSql(base), base.params),
    pool.query(
      `SELECT ${LIST_SELECT}
       ${FROM_SQL}
       ${VENDOR_REPLACEMENT_CHAIN_LATERAL}
       ${base.joinSql || ''}
       ${base.whereSql}
       ORDER BY ${orderBy}
       LIMIT $${base.params.length + 1} OFFSET $${base.params.length + 2}`,
      listParams
    ),
  ]);
  const total = countRes.rows[0]?.total || 0;
  const uniqueTotal = uniqueRes.rows[0]?.unique_total || 0;
  return {
    data: listRes.rows.map(mapVendorMasterRow),
    pagination: {
      page,
      limit,
      total,
      unique_total: uniqueTotal,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

async function listAllForExport(query = {}) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20000, 1), 20000);
  const soldList = usesSoldDateFilters(query);
  const rentalList = usesRentalDateFilters(query);
  const base = buildVendorMasterFilters(query);
  const orderBy = soldList
    ? `${soldDateExpr()} DESC NULLS LAST, s.serial_id DESC`
    : rentalList
      ? `${rentalDateExpr()} DESC NULLS LAST, s.serial_id DESC`
      : 'p.purchase_order_date DESC NULLS LAST, s.serial_id DESC';
  const listRes = await pool.query(
    `SELECT ${LIST_SELECT}
     ${FROM_SQL}
     ${VENDOR_REPLACEMENT_CHAIN_LATERAL}
     ${base.joinSql || ''}
     ${base.whereSql}
     ORDER BY ${orderBy}
     LIMIT $${base.params.length + 1}`,
    [...base.params, limit]
  );
  return listRes.rows.map(mapVendorMasterRow);
}

function fmtExportMoney(n) {
  if (n == null || n === '') return '';
  return Number(n);
}

async function buildExportWorkbook(query = {}) {
  const rows = await listAllForExport(query);
  const sheetRows = rows.map((r, idx) => ({
    'S.No': idx + 1,
    TTSPL: r.ttspl_display || r.ttspl_id || '',
    'Original TTSPL': r.ttspl_id || '',
    'Replacement TTSPL': r.latest_replacement_ttspl || '',
    'Serial Number': r.serial_number || '',
    Vendor: r.vendor_name || '',
    'Purchase Date': r.purchase_date || '',
    'Sold Date': r.sold_date || '',
    'Purchase Order': r.purchase_order_number || '',
    'Purchase Rate': fmtExportMoney(r.purchase_rate),
    Brand: r.brand || '',
    Model: r.model || '',
    Generation: r.generation || '',
    Processor: r.processor || '',
    RAM: r.ram || '',
    Storage: r.storage || '',
    Graphics: r.graphics || '',
    'Screen Size': r.screen_size || '',
    'Current Status': String(r.current_status || '').replace(/_/g, ' '),
    'Current Location': r.location_label || r.current_location || '',
    'Current Stage': r.current_stage || '',
    Customer: r.customer_name || '',
    'SO Number': r.sales_order_number || '',
    'DC Number': r.delivery_challan_number || '',
    'Sale Price': fmtExportMoney(r.sale_price),
    'Monthly Rental Rate': fmtExportMoney(r.customer_monthly_rate),
    'Last Movement Date': r.last_movement_date || '',
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheetRows.length ? sheetRows : [{ Note: 'No rows match filters' }]);
  XLSX.utils.book_append_sheet(wb, ws, 'Vendor Master');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return { buf, filename: 'master_vendor_data.xlsx' };
}

module.exports = {
  getOverview,
  listLaptops,
  getLaptopColumnValues,
  buildExportWorkbook,
  WAREHOUSE_BUCKET_SQL,
  WAREHOUSE_STAGE_KEYS,
  emptyWarehouseStages,
  usageSql,
  physicalSerialKeySql,
  locationLabelSql,
  VENDOR_MASTER_COLUMN_KEYS: columnKeys(),
  VENDOR_MASTER_COLUMNS: COLUMNS,
};
