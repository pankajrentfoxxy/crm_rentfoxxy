/**
 * Master Data Dashboard — one row per laptop + KPI / customer / vendor / floor summaries.
 * Reuses vendor_serial_numbers as the asset master (no duplicated fleet table).
 */
const pool = require('../config/db');
const { pickMultiSpecFilters, buildSerialSpecFilter } = require('../utils/inventorySpecFilter');
const { appendDateRangeClauses, resolveMasterDateRange, parseCsvQuery } = require('../utils/dateRangeFilter');
const { DEPLOYED_WITH_CUSTOMER_STATUSES } = require('./customerDeployedAssets');
const {
  buildDashboardCacheKey,
  buildKpiCacheKey,
  getCachedDashboard,
  setCachedDashboard,
  getCachedKpis,
  setCachedKpis,
  invalidateMasterDataCachesFireAndForget,
} = require('./masterDataCache');

const CUSTOMER_STATUSES = DEPLOYED_WITH_CUSTOMER_STATUSES;

/** Commercial classification for sale vs rental filters + price KPIs. */
const SQL_IS_SALE = `(
  s.inventory_status = 'sold'
  OR LOWER(COALESCE(sos.quotation_type, '')) LIKE '%sale%'
)`;

const SQL_IS_RENTAL = `(
  s.inventory_status <> 'sold'
  AND LOWER(COALESCE(sos.quotation_type, '')) NOT LIKE '%sale%'
  AND (
    s.inventory_status IN ('rented', 'on_demo', 'reserved', 'in_transit', 'returned')
    OR COALESCE(s.rent_monthly_rate, 0) > 0
    OR LOWER(COALESCE(sos.quotation_type, '')) IN ('rental', 'demo')
  )
)`;

/** Delivery / rent start / GRN receive — not row sync updated_at. */
const MASTER_ACTIVITY_DATE_EXPR = 'COALESCE(s.delivered_at, s.rent_start_date, g.created_at, s.created_at)';

const VENDOR_REPAIR_EXISTS = `
  EXISTS (
    SELECT 1
      FROM vendor_repair_dc_items vri
      JOIN vendor_repair_delivery_challans vrdc ON vrdc.dc_number = vri.dc_number
     WHERE vri.serial_id = s.serial_id
       AND COALESCE(vrdc.status, '') NOT IN ('cancelled', 'closed', 'received', 'returned')
  )
`;

function parseExtra(extra) {
  if (!extra) return {};
  if (typeof extra === 'object') return extra;
  try {
    return JSON.parse(extra);
  } catch {
    return {};
  }
}

function locationForRow(row) {
  const st = String(row.inventory_status || '').toLowerCase();
  if (CUSTOMER_STATUSES.includes(st)) return 'Customer';
  if (row.on_vendor_repair) return 'Vendor';
  if (row.active_floor_ticket_id || ['returned', 'qc_failed', 'in_repair'].includes(st)) return 'Floor';
  return 'Inventory';
}

function buildMasterFilters(query = {}) {
  const params = [];
  const clauses = ['s.deleted_at IS NULL', 's.po_id IS NOT NULL'];

  const search = String(query.search || '').trim();
  if (search) {
    params.push(`%${search}%`);
    const i = params.length;
    clauses.push(`(
      s.serial_number ILIKE $${i}
      OR COALESCE(s.inventory_asset_code, '') ILIKE $${i}
      OR COALESCE(s.extra->>'ttspl_id', '') ILIKE $${i}
      OR COALESCE(c.company_name, c.name, '') ILIKE $${i}
      OR COALESCE(v.business_name, '') ILIKE $${i}
      OR COALESCE(p.purchase_order_number, '') ILIKE $${i}
      OR COALESCE(s.current_dc_number, '') ILIKE $${i}
      OR EXISTS (
        SELECT 1 FROM sales_order_serials sos
         WHERE sos.serial_id = s.serial_id
           AND (sos.sales_order_number ILIKE $${i} OR COALESCE(sos.dc_number, '') ILIKE $${i})
      )
    )`);
  }

  const statuses = parseCsvQuery(query.status);
  if (statuses.length) {
    params.push(statuses);
    clauses.push(`s.inventory_status = ANY($${params.length}::text[])`);
  }

  const locations = parseCsvQuery(query.location).map((l) => l.toLowerCase());
  if (locations.length) {
    const locParts = [];
    if (locations.includes('customer')) {
      params.push(CUSTOMER_STATUSES);
      locParts.push(`s.inventory_status = ANY($${params.length}::text[])`);
    }
    if (locations.includes('inventory')) {
      locParts.push(`s.inventory_status = 'in_stock'`);
    }
    if (locations.includes('floor')) {
      locParts.push(`(
        EXISTS (
          SELECT 1 FROM tickets tk
           WHERE tk.vendor_serial_id = s.serial_id
             AND tk.status IN ('in_progress', 'on_hold')
        )
        OR s.inventory_status IN ('returned', 'qc_failed', 'in_repair')
      )`);
    }
    if (locations.includes('vendor')) {
      locParts.push(VENDOR_REPAIR_EXISTS);
    }
    if (locParts.length) clauses.push(`(${locParts.join(' OR ')})`);
  }

  const stages = parseCsvQuery(query.stage);
  if (stages.length) {
    params.push(stages);
    clauses.push(`EXISTS (
      SELECT 1 FROM tickets tk
      JOIN stages st ON st.stage_id = tk.current_stage_id
      WHERE tk.vendor_serial_id = s.serial_id
        AND tk.status IN ('in_progress', 'on_hold')
        AND st.stage_name = ANY($${params.length}::text[])
    )`);
  }

  const customerIds = parseCsvQuery(query.customer_id).map(Number).filter((n) => n > 0);
  if (customerIds.length) {
    params.push(customerIds);
    clauses.push(`s.current_customer_id = ANY($${params.length}::int[])`);
  }

  const vendorIds = parseCsvQuery(query.vendor_id).map(Number).filter((n) => n > 0);
  if (vendorIds.length) {
    params.push(vendorIds);
    clauses.push(`p.vendor_id = ANY($${params.length}::int[])`);
  }

  // All laptops purchased from any vendor (sourcing), not "currently at vendor repair".
  const fromVendor = String(query.from_vendor || query.has_vendor || '').trim().toLowerCase();
  if (fromVendor === '1' || fromVendor === 'true' || fromVendor === 'yes') {
    clauses.push(`p.vendor_id IS NOT NULL`);
  }

  // Ready to Rent/Sale: in stock + QC passed (matches KPI card definition).
  const ready = String(query.ready || query.ready_to_rent || '').trim().toLowerCase();
  if (ready === '1' || ready === 'true' || ready === 'yes') {
    clauses.push(`s.inventory_status = 'in_stock'`);
    clauses.push(`LOWER(COALESCE(s.qc_status, s.extra->>'status', '')) = 'passed'`);
  }

  // QC Process: in-house units that are NOT ready to rent/sale
  // (inventory pending QC, floor, repair, returns — excludes customer-deployed).
  const qcProcess = String(query.qc_process || query.qcProcess || '').trim().toLowerCase();
  if (qcProcess === '1' || qcProcess === 'true' || qcProcess === 'yes') {
    params.push(CUSTOMER_STATUSES);
    clauses.push(`NOT (s.inventory_status = ANY($${params.length}::text[]))`);
    clauses.push(`NOT (
      s.inventory_status = 'in_stock'
      AND LOWER(COALESCE(s.qc_status, s.extra->>'status', '')) = 'passed'
    )`);
  }

  const entities = parseCsvQuery(query.entity).map((e) => e.toLowerCase());
  if (entities.length) {
    params.push(entities);
    clauses.push(`LOWER(COALESCE(s.current_entity, '')) = ANY($${params.length}::text[])`);
  }

  const pricingTypes = parseCsvQuery(query.pricing_type || query.pricingType).map((t) => t.toLowerCase());
  if (pricingTypes.includes('sale') && pricingTypes.includes('rental')) {
    clauses.push(`(${SQL_IS_SALE} OR ${SQL_IS_RENTAL})`);
  } else if (pricingTypes.includes('sale')) {
    clauses.push(SQL_IS_SALE);
  } else if (pricingTypes.includes('rental')) {
    clauses.push(SQL_IS_RENTAL);
  }

  const dateRange = resolveMasterDateRange(query);
  const usePurchaseDate = String(query.date_basis || query.dateBasis || '').toLowerCase() === 'purchase';
  if (usePurchaseDate) {
    const purchaseClausesForRange = (range) => {
      const parts = [];
      if (range?.dateFrom) {
        params.push(range.dateFrom);
        parts.push(`p.purchase_order_date >= $${params.length}::date`);
      }
      if (range?.dateTo) {
        params.push(range.dateTo);
        parts.push(`p.purchase_order_date <= $${params.length}::date`);
      }
      return parts.length ? `(${parts.join(' AND ')})` : null;
    };
    if (Array.isArray(dateRange.ranges) && dateRange.ranges.length > 1) {
      const orParts = dateRange.ranges.map(purchaseClausesForRange).filter(Boolean);
      if (orParts.length) clauses.push(`(${orParts.join(' OR ')})`);
    } else {
      const one = purchaseClausesForRange(dateRange);
      if (one) clauses.push(one);
    }
  } else if (Array.isArray(dateRange.ranges) && dateRange.ranges.length > 1) {
    const orParts = dateRange.ranges.map((range) => {
      const parts = appendDateRangeClauses({
        expr: MASTER_ACTIVITY_DATE_EXPR,
        dateFrom: range.dateFrom,
        dateTo: range.dateTo,
        params,
        timezone: 'Asia/Kolkata',
      });
      return parts.length ? `(${parts.join(' AND ')})` : null;
    }).filter(Boolean);
    if (orParts.length) clauses.push(`(${orParts.join(' OR ')})`);
  } else {
    const dateClauses = appendDateRangeClauses({
      expr: MASTER_ACTIVITY_DATE_EXPR,
      dateFrom: dateRange.dateFrom,
      dateTo: dateRange.dateTo,
      params,
      timezone: 'Asia/Kolkata',
    });
    if (dateClauses.length) clauses.push(...dateClauses);
  }

  const specFilters = pickMultiSpecFilters(query);
  const spec = buildSerialSpecFilter(specFilters, params);
  if (spec.whereSql) clauses.push(spec.whereSql.replace(/^\s*AND\s+/i, ''));

  const applyVendorPoExclusion = String(
    query.apply_vendor_po_exclusion || query.applyVendorPoExclusion || ''
  ).trim().toLowerCase();
  if (applyVendorPoExclusion === '1' || applyVendorPoExclusion === 'true' || applyVendorPoExclusion === 'yes') {
    clauses.push(`COALESCE(v.exclude_from_vendor_po, FALSE) = FALSE`);
  }

  return {
    whereSql: `WHERE ${clauses.join(' AND ')}`,
    params,
    joinSql: spec.joinSql || '',
  };
}

const FROM_SQL = `
  FROM vendor_serial_numbers s
  INNER JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
  LEFT JOIN vendors v ON v.vendor_id = p.vendor_id
  LEFT JOIN vendor_goods_received_notes g ON g.grn_id = s.grn_id AND g.deleted_at IS NULL
  LEFT JOIN customers c ON c.customer_id = s.current_customer_id
  LEFT JOIN LATERAL (
    SELECT tk.ticket_id, st.stage_name
      FROM tickets tk
      LEFT JOIN stages st ON st.stage_id = tk.current_stage_id
     WHERE tk.vendor_serial_id = s.serial_id
       AND tk.status IN ('in_progress', 'on_hold')
     ORDER BY tk.created_at DESC
     LIMIT 1
  ) active_ticket ON true
  LEFT JOIN LATERAL (
    SELECT sos.sales_order_number, sos.dc_number, sol.rate AS so_rate, sol.quotation_type
      FROM sales_order_serials sos
      LEFT JOIN sales_order_lines sol ON sol.id = sos.line_id
     WHERE sos.serial_id = s.serial_id
       AND sos.status <> 'removed'
     ORDER BY sos.allocation_id DESC
     LIMIT 1
  ) sos ON true
  LEFT JOIN LATERAL (
    SELECT 1 AS on_vendor_repair
      FROM vendor_repair_dc_items vri
      JOIN vendor_repair_delivery_challans vrdc ON vrdc.dc_number = vri.dc_number
     WHERE vri.serial_id = s.serial_id
       AND COALESCE(vrdc.status, '') NOT IN ('cancelled', 'closed', 'received', 'returned')
     LIMIT 1
  ) vr ON true
  LEFT JOIN LATERAL (
    -- Prefer the exact PO line this unit was received on (extra.product_detail_id).
    -- Brand/model-only matching on multi-line POs often picks another line's rate
    -- (e.g. a bulk/high-end SKU), which is why Vendor Price looked wrong vs rent.
    SELECT
        vpd.rate AS purchase_rate,
        vpd.product_detail_id,
        vpd.brand,
        vpd.model,
        (
          SELECT NULLIF(TRIM(li.elem->>'monthly_rental_amount'), '')::numeric
            FROM jsonb_array_elements(COALESCE(p.line_items, '[]'::jsonb)) AS li(elem)
           WHERE LOWER(TRIM(COALESCE(li.elem->>'brand', ''))) = LOWER(TRIM(COALESCE(vpd.brand, '')))
             AND LOWER(TRIM(COALESCE(li.elem->>'model', ''))) = LOWER(TRIM(COALESCE(vpd.model, '')))
           ORDER BY
             CASE
               WHEN LOWER(TRIM(COALESCE(li.elem->>'processor', ''))) = LOWER(TRIM(COALESCE(vpd.processor, '')))
                AND LOWER(TRIM(COALESCE(li.elem->>'ram', ''))) = LOWER(TRIM(COALESCE(vpd.ram, '')))
               THEN 0
               ELSE 1
             END
           LIMIT 1
        ) AS monthly_rental_amount
      FROM vendor_product_details vpd
     WHERE vpd.po_id = s.po_id
       AND (
         vpd.product_detail_id = NULLIF(TRIM(s.extra->>'product_detail_id'), '')::int
         OR (
           NULLIF(TRIM(s.extra->>'product_detail_id'), '') IS NULL
           AND LOWER(TRIM(COALESCE(vpd.brand, ''))) = LOWER(TRIM(COALESCE(s.extra->>'brand', '')))
           AND LOWER(TRIM(COALESCE(vpd.model, ''))) = LOWER(TRIM(COALESCE(
             s.extra->>'model', s.extra->>'model_name', ''
           )))
           AND (
             NULLIF(TRIM(s.extra->>'processor'), '') IS NULL
             OR LOWER(TRIM(COALESCE(vpd.processor, ''))) = LOWER(TRIM(s.extra->>'processor'))
           )
           AND (
             NULLIF(TRIM(s.extra->>'ram'), '') IS NULL
             OR LOWER(TRIM(COALESCE(vpd.ram, ''))) = LOWER(TRIM(s.extra->>'ram'))
           )
         )
         OR (
           -- Single-line PO: safe to take that one rate
           (SELECT COUNT(*) FROM vendor_product_details x WHERE x.po_id = s.po_id) = 1
         )
       )
     ORDER BY
       CASE
         WHEN vpd.product_detail_id = NULLIF(TRIM(s.extra->>'product_detail_id'), '')::int THEN 0
         WHEN LOWER(TRIM(COALESCE(vpd.brand, ''))) = LOWER(TRIM(COALESCE(s.extra->>'brand', '')))
          AND LOWER(TRIM(COALESCE(vpd.model, ''))) = LOWER(TRIM(COALESCE(
            s.extra->>'model', s.extra->>'model_name', ''
          )))
          AND LOWER(TRIM(COALESCE(vpd.processor, ''))) = LOWER(TRIM(COALESCE(s.extra->>'processor', '')))
          AND LOWER(TRIM(COALESCE(vpd.ram, ''))) = LOWER(TRIM(COALESCE(s.extra->>'ram', '')))
         THEN 1
         WHEN LOWER(TRIM(COALESCE(vpd.brand, ''))) = LOWER(TRIM(COALESCE(s.extra->>'brand', '')))
          AND LOWER(TRIM(COALESCE(vpd.model, ''))) = LOWER(TRIM(COALESCE(
            s.extra->>'model', s.extra->>'model_name', ''
          )))
         THEN 2
         ELSE 3
       END,
       vpd.product_detail_id ASC
     LIMIT 1
  ) vpd ON true
`;

function formatPurchaseOrderType(t) {
  const key = String(t || '').toLowerCase();
  if (key === 'rental_purchase') return 'Rental';
  if (key === 'rent_to_own') return 'Rent to Own';
  if (key === 'direct_purchase') return 'Direct Purchase';
  if (!key) return null;
  return String(t)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function mapLaptopRow(row) {
  const ex = parseExtra(row.extra);
  const status = String(row.inventory_status || '').toLowerCase();
  const location = locationForRow(row);
  // Only show customer assignment docs/prices while the laptop is actually out
  // with a customer. Inventory / floor / scrapped rows keep stale SO/DC from
  // the last allocation — hide those so the list reflects current state only.
  const withCustomer = CUSTOMER_STATUSES.includes(status);

  const qt = String(row.quotation_type || '').toLowerCase();
  const isSale = qt.includes('sale') || status === 'sold';
  const soRate = row.so_rate != null && row.so_rate !== '' ? Number(row.so_rate) : null;
  const rentRate = row.rent_monthly_rate != null && row.rent_monthly_rate !== ''
    ? Number(row.rent_monthly_rate)
    : null;

  const poType = row.purchase_order_type || null;
  const isVendorRental = ['rental_purchase', 'rent_to_own'].includes(String(poType || '').toLowerCase());
  const purchaseRate = row.purchase_rate != null && row.purchase_rate !== ''
    ? Number(row.purchase_rate)
    : null;
  const monthlyRental = row.monthly_rental_amount != null && row.monthly_rental_amount !== ''
    ? Number(row.monthly_rental_amount)
    : null;
  // Rental POs: prefer explicit monthly_rental_amount, else VPD rate (legacy = rent/mo).
  // Direct purchase: VPD rate is the buy price.
  const vendorPrice = isVendorRental
    ? (monthlyRental ?? purchaseRate)
    : purchaseRate;
  const vendorPriceType = vendorPrice == null
    ? null
    : (isVendorRental ? 'monthly' : 'purchase');

  let customerPrice = null;
  let customerPriceType = null;
  if (withCustomer) {
    if (isSale) {
      customerPrice = soRate ?? rentRate;
      customerPriceType = customerPrice != null ? 'sale' : null;
    } else {
      customerPrice = rentRate ?? soRate;
      customerPriceType = customerPrice != null ? 'monthly' : null;
    }
  }

  return {
    serial_id: row.serial_id,
    ttspl_id: row.inventory_asset_code || ex.ttspl_id || null,
    serial_number: row.serial_number,
    brand: ex.brand || '',
    model: ex.model || ex.model_name || '',
    processor: ex.processor || '',
    generation: ex.generation || '',
    ram: ex.ram || '',
    storage: ex.storage || ex.ssd || '',
    graphics: ex.gpu || ex.graphics || '',
    screen_size: ex.screen_size || ex.screen || '',
    inventory_status: row.inventory_status,
    current_status: row.inventory_status,
    current_location: location,
    current_stage: row.ticket_stage_name || null,
    active_floor_ticket_id: row.active_floor_ticket_id || null,
    customer_id: withCustomer ? (row.current_customer_id || null) : null,
    customer_name: withCustomer ? (row.customer_name || null) : null,
    vendor_id: row.vendor_id || null,
    vendor_name: row.vendor_name || null,
    purchase_order_type: poType,
    purchase_order_type_label: formatPurchaseOrderType(poType),
    vendor_purchase_price: vendorPrice,
    vendor_price_type: vendorPriceType,
    customer_monthly_rate: withCustomer && !isSale ? customerPrice : null,
    sale_price: withCustomer && isSale ? customerPrice : null,
    customer_price: customerPrice,
    customer_price_type: customerPriceType,
    sales_order_number: withCustomer ? (row.sales_order_number || null) : null,
    delivery_challan_number: withCustomer
      ? (row.current_dc_number || row.sos_dc_number || null)
      : null,
    quotation_type: withCustomer ? (row.quotation_type || null) : null,
    purchase_order_number: row.purchase_order_number || null,
    po_id: row.po_id || null,
    grn_number: row.grn_id != null ? `GRN-${String(row.grn_id).padStart(4, '0')}` : null,
    grn_id: row.grn_id || null,
    entity_code: row.current_entity || null,
    rent_start_date: withCustomer ? (row.rent_start_date || null) : null,
    delivered_at: withCustomer ? (row.delivered_at || null) : null,
  };
}

async function getKpis(query = {}) {
  // KPI cards follow the shared filter bar (date, specs, status, location,
  // stage, entity, pricing, search) and Vendor PO exclusions. Card drill-downs
  // (customer_id / vendor_id / from_vendor / ready / qc_process) stay off so
  // clicking a card does not collapse the other overview numbers.
  const dateRange = resolveMasterDateRange(query);
  const kpiQuery = {
    search: query.search,
    status: query.status,
    location: query.location,
    stage: query.stage,
    entity: query.entity,
    pricing_type: query.pricing_type || query.pricingType,
    pricingType: query.pricingType || query.pricing_type,
    date_mode: dateRange.dateMode || query.date_mode || query.dateMode,
    month: dateRange.month || query.month,
    date_from: dateRange.dateFrom,
    date_to: dateRange.dateTo,
    dateFrom: dateRange.dateFrom,
    dateTo: dateRange.dateTo,
    apply_vendor_po_exclusion: '1',
    ...pickMultiSpecFilters(query),
  };

  const kpiKey = buildKpiCacheKey(kpiQuery);
  const cachedKpis = await getCachedKpis(kpiKey);
  if (cachedKpis !== undefined) return cachedKpis;

  const { whereSql, params, joinSql } = buildMasterFilters(kpiQuery);
  const deployedIdx = params.length + 1;
  const kpiParams = [...params, CUSTOMER_STATUSES];

  const kpiRes = await pool.query(
    `SELECT
        COUNT(*)::int AS total_laptops,
        COUNT(DISTINCT s.current_customer_id) FILTER (WHERE s.current_customer_id IS NOT NULL)::int AS total_customers,
        COUNT(DISTINCT p.vendor_id) FILTER (WHERE p.vendor_id IS NOT NULL)::int AS total_vendors,
        COUNT(*) FILTER (WHERE s.inventory_status = ANY($${deployedIdx}::text[]))::int AS total_active_customer_assets,
        COUNT(*) FILTER (
          WHERE s.current_customer_id IS NOT NULL
             OR s.inventory_status = ANY($${deployedIdx}::text[])
        )::int AS total_with_customer,
        COUNT(*) FILTER (WHERE p.vendor_id IS NOT NULL)::int AS total_from_vendors,
        COUNT(*) FILTER (
          WHERE s.inventory_status = 'in_stock'
            AND LOWER(COALESCE(s.qc_status, s.extra->>'status', '')) = 'passed'
        )::int AS total_ready_to_rent_sale,
        COUNT(*) FILTER (
          WHERE NOT (s.inventory_status = ANY($${deployedIdx}::text[]))
            AND NOT (
              s.inventory_status = 'in_stock'
              AND LOWER(COALESCE(s.qc_status, s.extra->>'status', '')) = 'passed'
            )
        )::int AS total_qc_process,
        COUNT(*) FILTER (WHERE ${SQL_IS_SALE})::int AS total_sale_units,
        COUNT(*) FILTER (WHERE ${SQL_IS_RENTAL})::int AS total_rental_units,
        COALESCE(SUM(COALESCE(sos.so_rate, 0)) FILTER (WHERE ${SQL_IS_SALE}), 0)::numeric AS total_sale_value,
        COALESCE(SUM(COALESCE(s.rent_monthly_rate, sos.so_rate, 0)) FILTER (
          WHERE ${SQL_IS_RENTAL}
            AND s.inventory_status IN ('rented', 'on_demo', 'reserved', 'in_transit')
        ), 0)::numeric AS total_monthly_rental_value
     ${FROM_SQL}
     ${joinSql}
     ${whereSql}`,
    kpiParams
  );

  const k = kpiRes.rows[0] || {};
  const payload = {
    total_laptops: k.total_laptops || 0,
    total_customers: k.total_customers || 0,
    total_vendors: k.total_vendors || 0,
    total_active_customer_assets: k.total_active_customer_assets || 0,
    total_with_customer: k.total_with_customer || 0,
    total_from_vendors: k.total_from_vendors || 0,
    total_ready_to_rent_sale: k.total_ready_to_rent_sale || 0,
    total_qc_process: k.total_qc_process || 0,
    total_sale_units: k.total_sale_units || 0,
    total_rental_units: k.total_rental_units || 0,
    total_sale_value: Number(k.total_sale_value || 0),
    total_monthly_rental_value: Number(k.total_monthly_rental_value || 0),
  };
  await setCachedKpis(kpiKey, payload);
  return payload;
}

async function listLaptops(query = {}) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 25, 1), 100);
  const offset = (page - 1) * limit;
  const { whereSql, params, joinSql } = buildMasterFilters(query);

  const listParams = [...params, limit, offset];
  const [countRes, listRes] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total ${FROM_SQL} ${joinSql} ${whereSql}`,
      params
    ),
    pool.query(
      `SELECT
          s.serial_id, s.serial_number, s.inventory_asset_code, s.extra, s.inventory_status,
          s.current_customer_id, s.current_dc_number, s.current_entity,
          s.rent_monthly_rate, s.rent_start_date, s.delivered_at, s.grn_id, s.qc_status,
          p.po_id, p.purchase_order_number, p.purchase_order_type, p.vendor_id,
          COALESCE(v.business_name, TRIM(CONCAT(COALESCE(v.first_name,''), ' ', COALESCE(v.last_name,'')))) AS vendor_name,
          COALESCE(c.company_name, c.name) AS customer_name,
          active_ticket.ticket_id AS active_floor_ticket_id,
          active_ticket.stage_name AS ticket_stage_name,
          sos.sales_order_number, sos.dc_number AS sos_dc_number, sos.so_rate, sos.quotation_type,
          vr.on_vendor_repair,
          vpd.purchase_rate,
          vpd.monthly_rental_amount
       ${FROM_SQL}
       ${joinSql}
       ${whereSql}
       ORDER BY s.serial_id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      listParams
    ),
  ]);

  const total = countRes.rows[0]?.total || 0;

  return {
    data: listRes.rows.map(mapLaptopRow),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

async function getCustomerSummary(query = {}) {
  const base = buildMasterFilters(query);
  const r = await pool.query(
    `SELECT
        s.current_customer_id AS customer_id,
        COALESCE(c.company_name, c.name) AS customer_name,
        COUNT(*)::int AS active_laptops,
        COUNT(*) FILTER (WHERE s.inventory_status = 'returned')::int AS returned_laptops,
        COALESCE(SUM(COALESCE(s.rent_monthly_rate, sos.so_rate, 0))
          FILTER (WHERE s.inventory_status IN ('rented', 'on_demo', 'reserved', 'in_transit')), 0)::numeric AS monthly_rental_value,
        COALESCE(SUM(COALESCE(sos.so_rate, 0))
          FILTER (WHERE s.inventory_status = 'sold'), 0)::numeric AS sale_value
     ${FROM_SQL}
     ${base.joinSql || ''}
     ${base.whereSql}
       AND s.current_customer_id IS NOT NULL
     GROUP BY s.current_customer_id, COALESCE(c.company_name, c.name)
     ORDER BY active_laptops DESC, customer_name ASC
     LIMIT 200`,
    base.params
  );

  const totals = r.rows.reduce(
    (acc, row) => {
      acc.total_customers += 1;
      acc.total_active_laptops += Number(row.active_laptops || 0);
      acc.total_returned_laptops += Number(row.returned_laptops || 0);
      acc.total_monthly_rental_value += Number(row.monthly_rental_value || 0);
      acc.total_sale_value += Number(row.sale_value || 0);
      return acc;
    },
    {
      total_customers: 0,
      total_active_laptops: 0,
      total_returned_laptops: 0,
      total_monthly_rental_value: 0,
      total_sale_value: 0,
    }
  );

  return { totals, customers: r.rows };
}

function isExcludedFromVendorPo(row) {
  return row?.exclude_from_vendor_po === true
    || row?.exclude_from_vendor_po === 't'
    || row?.exclude_from_vendor_po === 1
    || row?.exclude_from_vendor_po === '1';
}

function summarizeVendorPoTotals(vendors = []) {
  return vendors.reduce(
    (acc, row) => {
      const excluded = isExcludedFromVendorPo(row);
      const laptops = Number(row.purchased_laptops || 0);
      const value = Number(row.purchase_value || 0);
      if (excluded) {
        acc.total_excluded_vendors += 1;
        acc.total_excluded_laptops += laptops;
        acc.total_excluded_purchase_value += value;
        return acc;
      }
      acc.total_vendors += 1;
      acc.total_purchased_laptops += laptops;
      acc.total_purchase_value += value;
      return acc;
    },
    {
      total_vendors: 0,
      total_purchased_laptops: 0,
      total_purchase_value: 0,
      total_excluded_vendors: 0,
      total_excluded_laptops: 0,
      total_excluded_purchase_value: 0,
    }
  );
}

async function getVendorSummary(query = {}) {
  const base = buildMasterFilters(query);
  const r = await pool.query(
    `SELECT
        p.vendor_id,
        COALESCE(v.business_name, TRIM(CONCAT(COALESCE(v.first_name,''), ' ', COALESCE(v.last_name,'')))) AS vendor_name,
        COALESCE(v.exclude_from_vendor_po, FALSE) AS exclude_from_vendor_po,
        COUNT(*)::int AS purchased_laptops,
        COALESCE(SUM(COALESCE(vpd.purchase_rate, 0)), 0)::numeric AS purchase_value
     ${FROM_SQL}
     ${base.joinSql || ''}
     ${base.whereSql}
       AND p.vendor_id IS NOT NULL
     GROUP BY p.vendor_id,
              COALESCE(v.business_name, TRIM(CONCAT(COALESCE(v.first_name,''), ' ', COALESCE(v.last_name,'')))),
              COALESCE(v.exclude_from_vendor_po, FALSE)
     ORDER BY COALESCE(v.exclude_from_vendor_po, FALSE) ASC,
              purchased_laptops DESC,
              vendor_name ASC
     LIMIT 200`,
    base.params
  );

  const vendors = r.rows.map((row) => ({
    ...row,
    exclude_from_vendor_po: isExcludedFromVendorPo(row),
  }));

  return { totals: summarizeVendorPoTotals(vendors), vendors };
}

async function setVendorExcludeFromVendorPo(vendorId, exclude) {
  const id = Number(vendorId);
  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error('Invalid vendor');
    err.statusCode = 400;
    throw err;
  }
  const r = await pool.query(
    `UPDATE vendors
        SET exclude_from_vendor_po = $2,
            updated_at = NOW()
      WHERE vendor_id = $1
        AND deleted_at IS NULL
      RETURNING vendor_id, exclude_from_vendor_po`,
    [id, Boolean(exclude)]
  );
  if (!r.rows[0]) {
    const err = new Error('Vendor not found');
    err.statusCode = 404;
    throw err;
  }
  invalidateMasterDataCachesFireAndForget();
  return {
    vendor_id: r.rows[0].vendor_id,
    exclude_from_vendor_po: isExcludedFromVendorPo(r.rows[0]),
  };
}

async function getFloorSummary() {
  const [stageRes, pendingInv, inventoryReady, floorMgr] = await Promise.all([
    pool.query(
      `SELECT s.stage_name, COUNT(t.ticket_id)::int AS count
         FROM stages s
         LEFT JOIN tickets t ON t.current_stage_id = s.stage_id
           AND t.status IN ('in_progress', 'on_hold')
        GROUP BY s.stage_name, s.stage_order
        ORDER BY s.stage_order ASC NULLS LAST, s.stage_name ASC`
    ),
    pool.query(
      `SELECT COUNT(*)::int AS c FROM production_assets WHERE COALESCE(status, '') IN ('qc_ready', 'pending_inventory')`
    ).catch(() => ({ rows: [{ c: 0 }] })),
    pool.query(
      `SELECT COUNT(*)::int AS c
         FROM vendor_serial_numbers s
        WHERE s.deleted_at IS NULL
          AND s.po_id IS NOT NULL
          AND s.inventory_status = 'in_stock'
          AND LOWER(COALESCE(s.qc_status, s.extra->>'status', '')) = 'passed'`
    ),
    pool.query(
      `SELECT COUNT(*)::int AS c
         FROM tickets t
         JOIN stages s ON s.stage_id = t.current_stage_id
        WHERE t.status IN ('in_progress', 'on_hold')
          AND s.stage_name ILIKE '%floor manager%'`
    ).catch(() => ({ rows: [{ c: 0 }] })),
  ]);

  const stages = stageRes.rows.map((r) => ({
    stage_name: r.stage_name,
    count: r.count || 0,
  }));

  // Ensure requested summary labels exist even if stages table naming differs
  const ensure = (name, count) => {
    if (!stages.some((s) => s.stage_name === name)) stages.push({ stage_name: name, count });
  };
  ensure('Floor Manager', floorMgr.rows[0]?.c || 0);
  ensure('Pending Inventory', pendingInv.rows[0]?.c || 0);
  ensure('Inventory', inventoryReady.rows[0]?.c || 0);

  return { stages };
}

async function getMasterDashboardTab(query = {}) {
  const tab = String(query.tab || 'laptops').toLowerCase();
  // Laptop / customer lists follow Vendor PO exclusions so clicking a KPI card
  // matches the filtered card count. Vendor tab keeps excluded rows visible.
  const scopedQuery = (tab === 'vendors' || tab === 'floor')
    ? query
    : { ...query, apply_vendor_po_exclusion: '1' };
  const cacheKey = buildDashboardCacheKey(scopedQuery);
  const cached = await getCachedDashboard(cacheKey);
  if (cached !== undefined) return cached;

  let payload;
  if (tab === 'customers') {
    payload = { tab, ...(await getCustomerSummary(scopedQuery)) };
  } else if (tab === 'vendors') {
    payload = { tab, ...(await getVendorSummary(query)) };
  } else if (tab === 'floor') {
    payload = { tab, ...(await getFloorSummary()) };
  } else {
    payload = { tab: 'laptops', ...(await listLaptops(scopedQuery)) };
  }

  await setCachedDashboard(cacheKey, payload);
  return payload;
}

/** @deprecated Use getMasterDashboardTab + getKpis separately for faster loads. */
async function getMasterDashboard(query = {}) {
  const [kpis, tabPayload] = await Promise.all([
    getKpis(query),
    getMasterDashboardTab(query),
  ]);
  return { kpis, ...tabPayload };
}

async function listAllLaptopsForExport(query = {}) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20000, 1), 20000);
  const { whereSql, params, joinSql } = buildMasterFilters(query);
  const listParams = [...params, limit];
  const listRes = await pool.query(
    `SELECT
        s.serial_id, s.serial_number, s.inventory_asset_code, s.extra, s.inventory_status,
        s.current_customer_id, s.current_dc_number, s.current_entity,
        s.rent_monthly_rate, s.rent_start_date, s.delivered_at, s.grn_id, s.qc_status,
        p.po_id, p.purchase_order_number, p.purchase_order_type, p.vendor_id,
        COALESCE(v.business_name, TRIM(CONCAT(COALESCE(v.first_name,''), ' ', COALESCE(v.last_name,'')))) AS vendor_name,
        COALESCE(c.company_name, c.name) AS customer_name,
        active_ticket.ticket_id AS active_floor_ticket_id,
        active_ticket.stage_name AS ticket_stage_name,
        sos.sales_order_number, sos.dc_number AS sos_dc_number, sos.so_rate, sos.quotation_type,
        vr.on_vendor_repair,
        vpd.purchase_rate,
        vpd.monthly_rental_amount
     ${FROM_SQL}
     ${joinSql}
     ${whereSql}
     ORDER BY s.serial_id DESC
     LIMIT $${params.length + 1}`,
    listParams
  );
  return listRes.rows.map(mapLaptopRow);
}

function fmtExportMoney(n) {
  if (n == null || n === '') return '';
  return Number(n);
}

function fmtExportVendorPrice(r) {
  if (r.vendor_purchase_price == null) return '';
  if (r.vendor_price_type === 'monthly') return Number(r.vendor_purchase_price);
  return Number(r.vendor_purchase_price);
}

function fmtExportCustomerPrice(r) {
  if (r.customer_price == null) return '';
  return Number(r.customer_price);
}

function laptopRowToExport(r, idx) {
  const specs = [r.processor, r.generation, r.ram, r.storage, r.graphics].filter(Boolean).join(' | ');
  return {
    'S.No': idx + 1,
    TTSPL: r.ttspl_id || '',
    'Serial Number': r.serial_number || '',
    Brand: r.brand || '',
    Model: r.model || '',
    Specs: specs,
    'Screen Size': r.screen_size || '',
    Status: String(r.current_status || '').replace(/_/g, ' '),
    Location: r.current_location || '',
    'Current Customer': r.customer_name || '',
    Vendor: r.vendor_name || '',
    'Vendor Type': r.purchase_order_type_label || '',
    'Vendor Price': fmtExportVendorPrice(r),
    'Vendor Price Type': r.vendor_price_type === 'monthly' ? 'Rent/mo' : (r.vendor_price_type === 'purchase' ? 'Purchase' : ''),
    'Customer Price': fmtExportCustomerPrice(r),
    'Customer Price Type': r.customer_price_type === 'sale' ? 'Sale' : (r.customer_price_type === 'monthly' ? 'Rent/mo' : ''),
    Stage: r.current_stage || '',
    'Sales Order': r.sales_order_number || '',
    'Delivery Challan': r.delivery_challan_number || '',
    'Purchase Order': r.purchase_order_number || '',
    GRN: r.grn_number || '',
    Entity: r.entity_code || '',
  };
}

async function buildMasterDataExportWorkbook(query = {}) {
  const XLSX = require('xlsx');
  const tab = String(query.tab || 'laptops').toLowerCase();
  let sheetRows = [];
  let sheetName = 'Master Data';

  if (tab === 'customers') {
    const { customers } = await getCustomerSummary({ ...query, apply_vendor_po_exclusion: '1' });
    sheetName = 'Customers';
    sheetRows = customers.map((c, idx) => ({
      'S.No': idx + 1,
      Customer: c.customer_name || '',
      'Customer ID': c.customer_id || '',
      Active: Number(c.active_laptops || 0),
      Returned: Number(c.returned_laptops || 0),
      'Monthly Rental Value': fmtExportMoney(c.monthly_rental_value),
      'Sale Value': fmtExportMoney(c.sale_value),
    }));
  } else if (tab === 'vendors') {
    const { vendors } = await getVendorSummary(query);
    sheetName = 'Vendors';
    sheetRows = vendors
      .filter((v) => !isExcludedFromVendorPo(v))
      .map((v, idx) => ({
        'S.No': idx + 1,
        Vendor: v.vendor_name || '',
        'Vendor ID': v.vendor_id || '',
        Laptops: Number(v.purchased_laptops || 0),
        'Purchase Value': fmtExportMoney(v.purchase_value),
      }));
  } else if (tab === 'floor') {
    const { stages } = await getFloorSummary();
    sheetName = 'Floor';
    sheetRows = stages.map((s, idx) => ({
      'S.No': idx + 1,
      Stage: s.stage_name || '',
      Count: Number(s.count || 0),
    }));
  } else {
    const rows = await listAllLaptopsForExport({ ...query, apply_vendor_po_exclusion: '1' });
    sheetName = 'Laptop Master';
    sheetRows = rows.map(laptopRowToExport);
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheetRows.length ? sheetRows : [{ Note: 'No rows match filters' }]);
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const safeTab = tab.replace(/[^\w-]+/g, '_');
  return { buf, filename: `master_data_${safeTab}.xlsx` };
}

module.exports = {
  getMasterDashboard,
  getMasterDashboardTab,
  listLaptops,
  getKpis,
  buildMasterDataExportWorkbook,
  setVendorExcludeFromVendorPo,
  CUSTOMER_STATUSES,
  FROM_SQL,
  buildMasterFilters,
  mapLaptopRow,
  SQL_IS_SALE,
  SQL_IS_RENTAL,
  VENDOR_REPAIR_EXISTS,
};
