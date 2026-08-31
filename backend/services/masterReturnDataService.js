/**
 * Master Return Data — laptops actually received back from customers,
 * then their CURRENT inventory / customer / warehouse stage.
 * Return date prefers warehouse inward; does not invent dates.
 */
const pool = require('../config/db');
const XLSX = require('xlsx');
const { pickMultiSpecFilters, buildSerialSpecFilter } = require('../utils/inventorySpecFilter');
const { appendDateRangeClauses, resolveMasterDateRange, parseCsvQuery } = require('../utils/dateRangeFilter');
const {
  mapLaptopRow,
  SQL_IS_SALE,
  SQL_IS_RENTAL,
  CUSTOMER_STATUSES,
} = require('./masterDataDashboardService');
const {
  WAREHOUSE_BUCKET_SQL,
  WAREHOUSE_STAGE_KEYS,
  emptyWarehouseStages,
  locationLabelSql,
} = require('./masterVendorDataService');

const CUSTOMER_SQL = CUSTOMER_STATUSES.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ');

const RETURN_AT_PICKUP_SQL = `
  COALESCE(sti.warehouse_received_at, rl.warehouse_received_at, rl.delivered_at, rl.created_at)
`;
const RETURN_AT_RDC_SQL = `
  COALESCE(rl.warehouse_received_at, rl.delivered_at, rl.created_at)
`;
const PICKUP_ELIGIBLE_SQL = `(
  sti.warehouse_received_at IS NOT NULL
  OR rl.warehouse_received_at IS NOT NULL
  OR (
    sti.warehouse_received_at IS NULL
    AND rl.warehouse_received_at IS NULL
    AND (rl.delivered_at IS NOT NULL OR LOWER(COALESCE(rl.status, '')) = 'delivered')
  )
)`;
const RDC_ELIGIBLE_SQL = `(
  rl.warehouse_received_at IS NOT NULL
  OR rl.delivered_at IS NOT NULL
  OR LOWER(COALESCE(rl.status, '')) = 'delivered'
)`;

const RETURN_TYPE_SQL = `
  CASE
    WHEN COALESCE(re.dc_purpose, '') = 'replacement'
      OR LOWER(COALESCE(re.ticket_category, '')) = 'replacement'
      OR LOWER(COALESCE(re.complaint_type, '')) = 'replacement'
      THEN 'replacement_return'
    WHEN COALESCE(re.pickup_type, 'return') = 'repair' THEN 'repair_pickup'
    WHEN COALESCE(re.pickup_type, 'return') = 'return' THEN 'customer_return'
    ELSE 'other'
  END
`;

const LOCATION_BUCKET_SQL = `
  CASE
    WHEN s.inventory_status IN (${CUSTOMER_SQL}) THEN 'customer'
    WHEN vr.on_vendor_repair IS NOT NULL
      OR s.inventory_status IN ('in_repair', 'out_for_repare') THEN 'repair'
    WHEN s.inventory_status IN ('in_stock', 'returned', 'qc_failed', 'scrapped')
      OR active_ticket.ticket_id IS NOT NULL THEN 'warehouse'
    ELSE 'other'
  END
`;

const CURRENT_STATE_JOINS = `
  LEFT JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
  LEFT JOIN vendors v ON v.vendor_id = p.vendor_id
  LEFT JOIN customers c ON c.customer_id = s.current_customer_id
  LEFT JOIN customers rc ON rc.customer_id = re.return_customer_id
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
    SELECT
        vpd.rate AS purchase_rate
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
         )
         OR (SELECT COUNT(*) FROM vendor_product_details x WHERE x.po_id = s.po_id) = 1
       )
     ORDER BY
       CASE
         WHEN vpd.product_detail_id = NULLIF(TRIM(s.extra->>'product_detail_id'), '')::int THEN 0
         ELSE 1
       END,
       vpd.product_detail_id ASC
     LIMIT 1
  ) vpd ON true
`;

function appendReturnDateClauses(expr, query, params) {
  const dateRange = resolveMasterDateRange(query);
  const clauses = [];
  const addRange = (range) => {
    const parts = appendDateRangeClauses({
      expr,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      params,
      timezone: 'Asia/Kolkata',
    });
    return parts.length ? `(${parts.join(' AND ')})` : null;
  };
  if (Array.isArray(dateRange.ranges) && dateRange.ranges.length > 1) {
    const orParts = dateRange.ranges.map(addRange).filter(Boolean);
    if (orParts.length) clauses.push(`(${orParts.join(' OR ')})`);
  } else {
    const one = addRange(dateRange);
    if (one) clauses.push(one);
  }
  return clauses;
}

function returnTypeCase(alias = 'sti', rdcAlias = 'rl', ticketAlias = 't') {
  return `
    CASE
      WHEN COALESCE(${rdcAlias}.dc_purpose, '') = 'replacement'
        OR LOWER(COALESCE(${ticketAlias}.ticket_category, '')) = 'replacement'
        OR LOWER(COALESCE(${ticketAlias}.complaint_type, '')) = 'replacement'
        THEN 'replacement_return'
      WHEN COALESCE(${alias}.pickup_type, 'return') = 'repair' THEN 'repair_pickup'
      WHEN COALESCE(${alias}.pickup_type, 'return') = 'return' THEN 'customer_return'
      ELSE 'other'
    END
  `;
}

function buildReturnEventsCte(query = {}, params) {
  const pickupDate = appendReturnDateClauses(RETURN_AT_PICKUP_SQL, query, params);
  const rdcDate = appendReturnDateClauses(RETURN_AT_RDC_SQL, query, params);
  const pickupDateSql = pickupDate.length ? `AND ${pickupDate.join(' AND ')}` : '';
  const rdcDateSql = rdcDate.length ? `AND ${rdcDate.join(' AND ')}` : '';

  return `
WITH eligible_pickups AS MATERIALIZED (
  SELECT
      sti.id AS pickup_item_id,
      sti.pickup_type,
      COALESCE(sti.return_dc_number, rl.dc_number) AS return_dc_number,
      COALESCE(rl.customer_id, t.customer_id) AS return_customer_id,
      COALESCE(rl.dc_purpose, '') AS dc_purpose,
      t.ticket_category,
      t.complaint_type,
      ${RETURN_AT_PICKUP_SQL} AS return_at,
      COALESCE(sti.warehouse_received_at, rl.warehouse_received_at) AS warehouse_received_at,
      ${returnTypeCase('sti', 'rl', 't')} AS return_type,
      NULLIF(TRIM(sti.serial_number), '') AS serial_number,
      NULLIF(TRIM(sti.ttspl_id), '') AS ttspl_id,
      NULLIF(TRIM(sti.unique_serial_number), '') AS unique_serial_number
    FROM support_ticket_items sti
    LEFT JOIN delivery_challan_lines rl
      ON rl.dc_number = sti.return_dc_number
     AND COALESCE(rl.movement_type, 'return') = 'return'
    LEFT JOIN support_tickets t ON t.id = sti.ticket_id
   WHERE sti.item_type = 'pickup'
     AND COALESCE(rl.status, '') NOT IN ('cancelled')
     AND ${PICKUP_ELIGIBLE_SQL}
     ${pickupDateSql}
),
pickup_matches AS (
  SELECT p.pickup_item_id, p.pickup_type, p.return_dc_number, p.return_customer_id,
         p.dc_purpose, p.ticket_category, p.complaint_type, p.return_at,
         p.warehouse_received_at, p.return_type, s.serial_id, 0 AS match_rank
    FROM eligible_pickups p
    JOIN vendor_serial_numbers s ON s.deleted_at IS NULL AND s.serial_number = p.serial_number
   WHERE p.serial_number IS NOT NULL
  UNION ALL
  SELECT p.pickup_item_id, p.pickup_type, p.return_dc_number, p.return_customer_id,
         p.dc_purpose, p.ticket_category, p.complaint_type, p.return_at,
         p.warehouse_received_at, p.return_type, s.serial_id, 1 AS match_rank
    FROM eligible_pickups p
    JOIN vendor_serial_numbers s ON s.deleted_at IS NULL AND s.inventory_asset_code = p.ttspl_id
   WHERE p.ttspl_id IS NOT NULL
  UNION ALL
  SELECT p.pickup_item_id, p.pickup_type, p.return_dc_number, p.return_customer_id,
         p.dc_purpose, p.ticket_category, p.complaint_type, p.return_at,
         p.warehouse_received_at, p.return_type, s.serial_id, 2 AS match_rank
    FROM eligible_pickups p
    JOIN vendor_serial_numbers s ON s.deleted_at IS NULL AND s.inventory_asset_code = p.unique_serial_number
   WHERE p.unique_serial_number IS NOT NULL
),
matched_pickups AS (
  SELECT DISTINCT ON (pickup_item_id)
         serial_id, pickup_item_id, pickup_type, return_dc_number, return_customer_id,
         dc_purpose, ticket_category, complaint_type, return_at, warehouse_received_at, return_type
    FROM pickup_matches
   ORDER BY pickup_item_id, match_rank, serial_id
),
eligible_rdc AS MATERIALIZED (
  SELECT
      rl.id,
      rl.dc_number,
      rl.customer_id,
      COALESCE(rl.dc_purpose, '') AS dc_purpose,
      rl.warehouse_received_at,
      ${RETURN_AT_RDC_SQL} AS return_at,
      CASE
        WHEN jsonb_typeof(rl.serial_number) = 'array' THEN rl.serial_number
        WHEN jsonb_typeof(rl.serial_number) = 'string' THEN jsonb_build_array(rl.serial_number #>> '{}')
        ELSE '[]'::jsonb
      END AS serials
    FROM delivery_challan_lines rl
   WHERE rl.movement_type = 'return'
     AND COALESCE(rl.status, '') NOT IN ('cancelled')
     AND ${RDC_ELIGIBLE_SQL}
     ${rdcDateSql}
),
rdc_elems AS (
  SELECT
      e.id,
      e.dc_number,
      e.customer_id,
      e.dc_purpose,
      e.warehouse_received_at,
      e.return_at,
      NULLIF(split_part(elem, '|', 3), '') AS ttspl,
      NULLIF(split_part(elem, '|', 2), '') AS serial_no,
      CASE
        WHEN NULLIF(REGEXP_REPLACE(split_part(elem, '|', 1), '[^0-9]', '', 'g'), '') ~ '^[0-9]+$'
        THEN NULLIF(REGEXP_REPLACE(split_part(elem, '|', 1), '[^0-9]', '', 'g'), '')::int
        ELSE NULL
      END AS serial_id_hint
    FROM eligible_rdc e
    CROSS JOIN LATERAL jsonb_array_elements_text(e.serials) AS elem
),
rdc_matches AS (
  SELECT e.*, s.serial_id
    FROM rdc_elems e
    JOIN vendor_serial_numbers s ON s.deleted_at IS NULL AND e.serial_no IS NOT NULL AND s.serial_number = e.serial_no
  UNION
  SELECT e.*, s.serial_id
    FROM rdc_elems e
    JOIN vendor_serial_numbers s ON s.deleted_at IS NULL AND e.ttspl IS NOT NULL AND s.inventory_asset_code = e.ttspl
  UNION
  SELECT e.*, s.serial_id
    FROM rdc_elems e
    JOIN vendor_serial_numbers s ON s.deleted_at IS NULL AND e.serial_id_hint IS NOT NULL AND s.serial_id = e.serial_id_hint
),
rdc_only AS (
  SELECT DISTINCT ON (m.id, m.serial_id)
      m.serial_id,
      NULL::int AS pickup_item_id,
      'return'::text AS pickup_type,
      m.dc_number AS return_dc_number,
      m.customer_id AS return_customer_id,
      m.dc_purpose,
      NULL::text AS ticket_category,
      NULL::text AS complaint_type,
      m.return_at,
      m.warehouse_received_at,
      CASE
        WHEN COALESCE(m.dc_purpose, '') = 'replacement' THEN 'replacement_return'
        ELSE 'customer_return'
      END AS return_type
    FROM rdc_matches m
   WHERE NOT EXISTS (
     SELECT 1 FROM matched_pickups mp
      WHERE mp.serial_id = m.serial_id
        AND mp.return_dc_number = m.dc_number
   )
   ORDER BY m.id, m.serial_id
),
combined_returns AS (
  SELECT * FROM matched_pickups
  UNION ALL
  SELECT * FROM rdc_only
),
return_events AS MATERIALIZED (
  SELECT DISTINCT ON (serial_id)
         serial_id,
         pickup_item_id,
         pickup_type,
         return_dc_number,
         return_customer_id,
         dc_purpose,
         ticket_category,
         complaint_type,
         return_at,
         warehouse_received_at,
         return_type
    FROM combined_returns
   ORDER BY serial_id, return_at DESC NULLS LAST, pickup_item_id DESC NULLS LAST
)
`;
}

function buildReturnMasterFilters(query = {}, params) {
  const clauses = ['s.deleted_at IS NULL'];

  const search = String(query.search || '').trim();
  if (search) {
    params.push(`%${search}%`);
    const i = params.length;
    clauses.push(`(
      s.serial_number ILIKE $${i}
      OR COALESCE(s.inventory_asset_code, '') ILIKE $${i}
      OR COALESCE(s.extra->>'ttspl_id', '') ILIKE $${i}
      OR COALESCE(rc.company_name, rc.name, '') ILIKE $${i}
      OR COALESCE(c.company_name, c.name, '') ILIKE $${i}
      OR COALESCE(re.return_dc_number, '') ILIKE $${i}
    )`);
  }

  const statuses = parseCsvQuery(query.status);
  if (statuses.length) {
    params.push(statuses);
    clauses.push(`s.inventory_status = ANY($${params.length}::text[])`);
  }

  const locations = parseCsvQuery(query.location).map((l) => l.toLowerCase());
  if (locations.length) {
    params.push(locations);
    clauses.push(`(${LOCATION_BUCKET_SQL}) = ANY($${params.length}::text[])`);
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
    clauses.push(`re.return_customer_id = ANY($${params.length}::int[])`);
  }

  const returnTypes = parseCsvQuery(query.return_type);
  if (returnTypes.length) {
    params.push(returnTypes);
    clauses.push(`re.return_type = ANY($${params.length}::text[])`);
  }

  const buckets = parseCsvQuery(query.warehouse_bucket);
  if (buckets.length) {
    params.push(buckets);
    clauses.push(`(${WAREHOUSE_BUCKET_SQL}) = ANY($${params.length}::text[])`);
  }

  const pricingTypes = parseCsvQuery(query.pricing_type || query.pricingType).map((t) => t.toLowerCase());
  if (pricingTypes.includes('sale') && pricingTypes.includes('rental')) {
    clauses.push(`(${SQL_IS_SALE} OR ${SQL_IS_RENTAL})`);
  } else if (pricingTypes.includes('sale')) {
    clauses.push(SQL_IS_SALE);
  } else if (pricingTypes.includes('rental')) {
    clauses.push(SQL_IS_RENTAL);
  }

  const specFilters = pickMultiSpecFilters(query);
  const spec = buildSerialSpecFilter(specFilters, params);
  if (spec.whereSql) clauses.push(spec.whereSql.replace(/^\s*AND\s+/i, ''));

  return {
    whereSql: `WHERE ${clauses.join(' AND ')}`,
    joinSql: spec.joinSql || '',
  };
}

function buildReturnQuery(query = {}, { withStateJoins = true } = {}) {
  const params = [];
  const cteSql = buildReturnEventsCte(query, params);
  const filters = withStateJoins
    ? buildReturnMasterFilters(query, params)
    : { whereSql: 'WHERE re.return_customer_id IS NOT NULL', joinSql: '' };
  const fromSql = withStateJoins
    ? `
    FROM return_events re
    JOIN vendor_serial_numbers s ON s.serial_id = re.serial_id
    ${CURRENT_STATE_JOINS}
    ${filters.joinSql || ''}
  `
    : `
    FROM return_events re
    LEFT JOIN customers rc ON rc.customer_id = re.return_customer_id
  `;
  return { cteSql, fromSql, whereSql: filters.whereSql, params };
}

function mapReturnRow(row) {
  const base = mapLaptopRow(row);
  const loc = row.location_bucket || null;
  const withCustomer = loc === 'customer';
  return {
    ...base,
    return_date: row.return_at || null,
    warehouse_received_at: row.warehouse_received_at || null,
    return_dc_number: row.return_dc_number || null,
    return_type: row.return_type || null,
    previous_customer_id: row.return_customer_id || null,
    previous_customer_name: row.previous_customer_name || null,
    last_movement_date: row.status_changed_at || row.updated_at || row.delivered_at || row.return_at || null,
    location_label: row.location_label || base.current_location,
    location_bucket: loc,
    warehouse_bucket: row.warehouse_bucket || null,
    purchase_rate: row.purchase_rate != null && row.purchase_rate !== ''
      ? Number(row.purchase_rate)
      : (base.vendor_price_type === 'purchase' ? base.vendor_purchase_price : null),
    customer_id: withCustomer ? (row.current_customer_id || base.customer_id) : null,
    customer_name: withCustomer ? (row.customer_name || base.customer_name) : null,
    sales_order_number: withCustomer ? (row.sales_order_number || base.sales_order_number) : null,
    delivery_challan_number: withCustomer
      ? (row.current_dc_number || row.sos_dc_number || base.delivery_challan_number)
      : null,
  };
}

const LIST_SELECT = `
  s.serial_id, s.serial_number, s.inventory_asset_code, s.extra, s.inventory_status,
  s.current_customer_id, s.current_dc_number, s.current_entity, s.updated_at,
  s.rent_monthly_rate, s.rent_start_date, s.delivered_at, s.grn_id, s.qc_status,
  s.status_changed_at,
  p.po_id, p.purchase_order_number, p.purchase_order_type, p.vendor_id, p.purchase_order_date,
  COALESCE(v.business_name, TRIM(CONCAT(COALESCE(v.first_name,''), ' ', COALESCE(v.last_name,'')))) AS vendor_name,
  COALESCE(c.company_name, c.name) AS customer_name,
  COALESCE(rc.company_name, rc.name) AS previous_customer_name,
  re.return_customer_id, re.return_dc_number, re.return_at, re.warehouse_received_at,
  re.return_type, re.pickup_type,
  active_ticket.ticket_id AS active_floor_ticket_id,
  active_ticket.stage_name AS ticket_stage_name,
  sos.sales_order_number, sos.dc_number AS sos_dc_number, sos.so_rate, sos.quotation_type,
  vr.on_vendor_repair,
  vpd.purchase_rate,
  (${WAREHOUSE_BUCKET_SQL}) AS warehouse_bucket,
  (${LOCATION_BUCKET_SQL}) AS location_bucket,
  (${locationLabelSql()}) AS location_label
`;

async function getOverview(query = {}) {
  const base = buildReturnQuery(query);
  const optionQuery = { ...query, customer_id: '', warehouse_bucket: '', location: '', return_type: '' };
  const option = buildReturnQuery(optionQuery, { withStateJoins: false });
  const loc = LOCATION_BUCKET_SQL;

  const [kpiRes, customerRes, optionRes] = await Promise.all([
    pool.query(
      `${base.cteSql}
       SELECT
          COUNT(*)::int AS total_returned,
          COALESCE(SUM(COALESCE(vpd.purchase_rate, 0)), 0)::numeric AS total_return_value,
          COUNT(*) FILTER (WHERE ${loc} = 'customer')::int AS customer_count,
          COUNT(*) FILTER (WHERE ${loc} = 'warehouse')::int AS warehouse_count,
          COUNT(*) FILTER (WHERE ${loc} = 'repair')::int AS out_for_repair_count,
          COUNT(*) FILTER (WHERE ${loc} = 'other')::int AS other_count,
          COUNT(*) FILTER (WHERE re.return_type = 'customer_return')::int AS type_customer_return,
          COUNT(*) FILTER (WHERE re.return_type = 'repair_pickup')::int AS type_repair_pickup,
          COUNT(*) FILTER (WHERE re.return_type = 'replacement_return')::int AS type_replacement_return,
          COUNT(*) FILTER (WHERE re.return_type = 'other')::int AS type_other,
          COUNT(*) FILTER (WHERE (${WAREHOUSE_BUCKET_SQL}) = 'qc1')::int AS qc1,
          COUNT(*) FILTER (WHERE (${WAREHOUSE_BUCKET_SQL}) = 'qc2')::int AS qc2,
          COUNT(*) FILTER (WHERE (${WAREHOUSE_BUCKET_SQL}) = 'diagnosis_hardware')::int AS diagnosis_hardware,
          COUNT(*) FILTER (WHERE (${WAREHOUSE_BUCKET_SQL}) = 'diagnosis_software')::int AS diagnosis_software,
          COUNT(*) FILTER (WHERE (${WAREHOUSE_BUCKET_SQL}) = 'final_testing')::int AS final_testing,
          COUNT(*) FILTER (WHERE (${WAREHOUSE_BUCKET_SQL}) = 'ready_to_rent')::int AS ready_to_rent,
          COUNT(*) FILTER (WHERE (${WAREHOUSE_BUCKET_SQL}) = 'ready_to_sell')::int AS ready_to_sell,
          COUNT(*) FILTER (WHERE (${WAREHOUSE_BUCKET_SQL}) = 'dead_scrapped')::int AS dead_scrapped,
          COUNT(*) FILTER (WHERE (${WAREHOUSE_BUCKET_SQL}) = 'other' AND ${loc} = 'warehouse')::int AS other_stage
       ${base.fromSql}
       ${base.whereSql}`,
      base.params
    ),
    pool.query(
      `${base.cteSql}
       SELECT
          re.return_customer_id AS customer_id,
          COALESCE(rc.company_name, rc.name, CONCAT('Customer #', re.return_customer_id)) AS customer_name,
          COUNT(*)::int AS returned_qty,
          COUNT(*) FILTER (WHERE ${loc} = 'warehouse')::int AS warehouse_qty,
          COUNT(*) FILTER (WHERE ${loc} = 'customer')::int AS customer_qty,
          COUNT(*) FILTER (WHERE ${loc} = 'repair')::int AS repair_qty,
          COUNT(*) FILTER (WHERE ${loc} = 'other')::int AS other_qty
       ${base.fromSql}
       ${base.whereSql}
         AND re.return_customer_id IS NOT NULL
       GROUP BY re.return_customer_id, COALESCE(rc.company_name, rc.name, CONCAT('Customer #', re.return_customer_id))
       ORDER BY returned_qty DESC, customer_name ASC
       LIMIT 300`,
      base.params
    ),
    pool.query(
      `${option.cteSql}
       SELECT DISTINCT
          re.return_customer_id AS customer_id,
          COALESCE(rc.company_name, rc.name, CONCAT('Customer #', re.return_customer_id)) AS customer_name
       ${option.fromSql}
       ${option.whereSql}
         AND re.return_customer_id IS NOT NULL
       ORDER BY customer_name ASC
       LIMIT 400`,
      option.params
    ).catch(() => ({ rows: [] })),
  ]);

  const k = kpiRes.rows[0] || {};
  const warehouse_stages = emptyWarehouseStages();
  WAREHOUSE_STAGE_KEYS.forEach((key) => {
    warehouse_stages[key] = Number(key === 'other' ? (k.other_stage || 0) : (k[key] || 0));
  });

  return {
    kpis: {
      total_returned: Number(k.total_returned || 0),
      total_return_value: Number(k.total_return_value || 0),
      customer_count: Number(k.customer_count || 0),
      warehouse_count: Number(k.warehouse_count || 0),
      out_for_repair_count: Number(k.out_for_repair_count || 0),
      other_count: Number(k.other_count || 0),
      return_types: {
        customer_return: Number(k.type_customer_return || 0),
        repair_pickup: Number(k.type_repair_pickup || 0),
        replacement_return: Number(k.type_replacement_return || 0),
        other: Number(k.type_other || 0),
      },
      warehouse_stages,
    },
    customers: customerRes.rows.map((row) => ({
      customer_id: row.customer_id,
      customer_name: row.customer_name,
      returned_qty: Number(row.returned_qty || 0),
      warehouse_qty: Number(row.warehouse_qty || 0),
      customer_qty: Number(row.customer_qty || 0),
      repair_qty: Number(row.repair_qty || 0),
      other_qty: Number(row.other_qty || 0),
    })),
    customer_options: (optionRes.rows || []).map((r) => ({
      value: String(r.customer_id),
      label: r.customer_name || `#${r.customer_id}`,
    })),
  };
}

async function listLaptops(query = {}) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 25, 1), 100);
  const offset = (page - 1) * limit;
  const base = buildReturnQuery(query);
  const listParams = [...base.params, limit, offset];
  const [countRes, listRes] = await Promise.all([
    pool.query(
      `${base.cteSql} SELECT COUNT(*)::int AS total ${base.fromSql} ${base.whereSql}`,
      base.params
    ),
    pool.query(
      `${base.cteSql}
       SELECT ${LIST_SELECT}
       ${base.fromSql}
       ${base.whereSql}
       ORDER BY re.return_at DESC NULLS LAST, s.serial_id DESC
       LIMIT $${base.params.length + 1} OFFSET $${base.params.length + 2}`,
      listParams
    ),
  ]);
  const total = countRes.rows[0]?.total || 0;
  return {
    data: listRes.rows.map(mapReturnRow),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

async function listAllForExport(query = {}) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20000, 1), 20000);
  const base = buildReturnQuery(query);
  const listRes = await pool.query(
    `${base.cteSql}
     SELECT ${LIST_SELECT}
     ${base.fromSql}
     ${base.whereSql}
     ORDER BY re.return_at DESC NULLS LAST, s.serial_id DESC
     LIMIT $${base.params.length + 1}`,
    [...base.params, limit]
  );
  return listRes.rows.map(mapReturnRow);
}

function fmtExportMoney(n) {
  if (n == null || n === '') return '';
  return Number(n);
}

const RETURN_TYPE_LABELS = {
  customer_return: 'Customer Return',
  repair_pickup: 'Repair Pickup',
  replacement_return: 'Replacement Return',
  other: 'Other Return',
};

async function buildExportWorkbook(query = {}) {
  const rows = await listAllForExport(query);
  const sheetRows = rows.map((r, idx) => ({
    'S.No': idx + 1,
    TTSPL: r.ttspl_id || '',
    'Serial Number': r.serial_number || '',
    'Previous Customer': r.previous_customer_name || '',
    'Return Date': r.return_date || '',
    'Return DC': r.return_dc_number || '',
    'Return Type': RETURN_TYPE_LABELS[r.return_type] || r.return_type || '',
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
    'Current Customer': r.customer_name || '',
    'Production Stage': r.current_stage || '',
    'Last Movement Date': r.last_movement_date || '',
    'Purchase Rate': fmtExportMoney(r.purchase_rate),
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(sheetRows.length ? sheetRows : [{ Note: 'No rows match filters' }]);
  XLSX.utils.book_append_sheet(wb, ws, 'Return Master');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return { buf, filename: 'master_return_data.xlsx' };
}

module.exports = {
  getOverview,
  listLaptops,
  buildExportWorkbook,
};
