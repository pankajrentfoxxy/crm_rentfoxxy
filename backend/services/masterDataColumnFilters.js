/**
 * Google Sheets-style column filters for Master Data laptop list.
 */
const { parseCsvQuery } = require('../utils/dateRangeFilter');
const { DEPLOYED_WITH_CUSTOMER_STATUSES } = require('./customerDeployedAssets');

const CUSTOMER_STATUSES = DEPLOYED_WITH_CUSTOMER_STATUSES;

const CUSTOMER_SQL = CUSTOMER_STATUSES.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ');

const VENDOR_NAME_EXPR = `COALESCE(v.business_name, TRIM(CONCAT(COALESCE(v.first_name,''), ' ', COALESCE(v.last_name,''))))`;

const SPECS_EXPR = `TRIM(BOTH ' | ' FROM CONCAT_WS(' | ',
  NULLIF(TRIM(COALESCE(s.extra->>'processor', '')), ''),
  NULLIF(TRIM(COALESCE(s.extra->>'generation', '')), ''),
  NULLIF(TRIM(COALESCE(s.extra->>'ram', '')), ''),
  NULLIF(TRIM(COALESCE(s.extra->>'storage', s.extra->>'ssd', '')), ''),
  NULLIF(TRIM(COALESCE(s.extra->>'gpu', s.extra->>'graphics', '')), ''),
  NULLIF(TRIM(COALESCE(s.extra->>'screen_size', s.extra->>'screen', '')), '')
))`;

function masterDataLocationSql() {
  return `
    CASE
      WHEN s.inventory_status IN (${CUSTOMER_SQL}) THEN 'Customer'
      WHEN vr.on_vendor_repair IS NOT NULL THEN 'Vendor'
      WHEN active_ticket.ticket_id IS NOT NULL
        OR s.inventory_status IN ('returned', 'qc_failed', 'in_repair') THEN 'Floor'
      ELSE 'Inventory'
    END
  `;
}

const VENDOR_TYPE_EXPR = `
  CASE LOWER(COALESCE(p.purchase_order_type, ''))
    WHEN 'rental_purchase' THEN 'Rental'
    WHEN 'rent_to_own' THEN 'Rent To Own'
    WHEN 'direct_purchase' THEN 'Direct Purchase'
    ELSE INITCAP(REPLACE(COALESCE(p.purchase_order_type, ''), '_', ' '))
  END
`;

const VENDOR_PRICE_EXPR = `
  CASE
    WHEN LOWER(COALESCE(p.purchase_order_type, '')) IN ('rental_purchase', 'rent_to_own')
      THEN CONCAT(COALESCE(vpd.monthly_rental_amount, vpd.purchase_rate, 0)::text, ' (Rent/mo)')
    WHEN vpd.purchase_rate IS NOT NULL THEN CONCAT(vpd.purchase_rate::text, ' (Purchase)')
    ELSE ''
  END
`;

const CUSTOMER_PRICE_EXPR = `
  CASE
    WHEN s.inventory_status NOT IN (${CUSTOMER_SQL}) THEN ''
    WHEN LOWER(COALESCE(sos.quotation_type, '')) LIKE '%sale%' OR s.inventory_status = 'sold'
      THEN CONCAT(COALESCE(sos.so_rate, s.rent_monthly_rate, 0)::text, ' (Sale)')
    ELSE CONCAT(COALESCE(s.rent_monthly_rate, sos.so_rate, 0)::text, ' (Rent/mo)')
  END
`;

const CUSTOMER_NAME_EXPR = `
  CASE
    WHEN s.inventory_status IN (${CUSTOMER_SQL}) THEN COALESCE(c.company_name, c.name, '')
    ELSE ''
  END
`;

const SO_EXPR = `
  CASE
    WHEN s.inventory_status IN (${CUSTOMER_SQL}) THEN COALESCE(sos.sales_order_number, '')
    ELSE ''
  END
`;

const DC_EXPR = `
  CASE
    WHEN s.inventory_status IN (${CUSTOMER_SQL}) THEN COALESCE(
      NULLIF(TRIM(s.current_dc_number), ''),
      NULLIF(TRIM(sos.dc_number), ''),
      ''
    )
    ELSE ''
  END
`;

const GRN_EXPR = `
  CASE
    WHEN s.grn_id IS NOT NULL THEN CONCAT('GRN-', LPAD(s.grn_id::text, 4, '0'))
    ELSE ''
  END
`;

/** @type {Record<string, { key: string, type: 'text'|'date'|'number', expr: string }>} */
const COLUMNS = {
  ttspl_id: {
    key: 'ttspl_id',
    type: 'text',
    expr: `COALESCE(NULLIF(TRIM(s.inventory_asset_code), ''), NULLIF(TRIM(s.extra->>'ttspl_id'), ''), '')`,
  },
  serial_number: {
    key: 'serial_number',
    type: 'text',
    expr: `COALESCE(s.serial_number, '')`,
  },
  specs: {
    key: 'specs',
    type: 'text',
    expr: `COALESCE(${SPECS_EXPR}, '')`,
  },
  current_status: {
    key: 'current_status',
    type: 'text',
    expr: `COALESCE(s.inventory_status, '')`,
  },
  current_location: {
    key: 'current_location',
    type: 'text',
    expr: '',
  },
  customer_name: {
    key: 'customer_name',
    type: 'text',
    expr: CUSTOMER_NAME_EXPR,
  },
  vendor_name: {
    key: 'vendor_name',
    type: 'text',
    expr: `COALESCE(${VENDOR_NAME_EXPR}, '')`,
  },
  vendor_type: {
    key: 'vendor_type',
    type: 'text',
    expr: VENDOR_TYPE_EXPR,
  },
  vendor_price: {
    key: 'vendor_price',
    type: 'text',
    expr: VENDOR_PRICE_EXPR,
  },
  customer_price: {
    key: 'customer_price',
    type: 'text',
    expr: CUSTOMER_PRICE_EXPR,
  },
  current_stage: {
    key: 'current_stage',
    type: 'text',
    expr: `COALESCE(active_ticket.stage_name, '')`,
  },
  sales_order_number: {
    key: 'sales_order_number',
    type: 'text',
    expr: SO_EXPR,
  },
  delivery_challan_number: {
    key: 'delivery_challan_number',
    type: 'text',
    expr: DC_EXPR,
  },
  purchase_order_number: {
    key: 'purchase_order_number',
    type: 'text',
    expr: `COALESCE(p.purchase_order_number, '')`,
  },
  grn_number: {
    key: 'grn_number',
    type: 'text',
    expr: GRN_EXPR,
  },
};

function columnKeys() {
  return Object.keys(COLUMNS);
}

function getColumnDef(key) {
  const col = COLUMNS[key];
  if (!col) return null;
  if (key === 'current_location') {
    return { ...col, expr: `COALESCE((${masterDataLocationSql()}), '')` };
  }
  return col;
}

function readColumnFilterState(query = {}) {
  const state = {};
  columnKeys().forEach((key) => {
    const col = COLUMNS[key];
    if (col.type === 'text') {
      const vals = parseCsvQuery(query[`cf_${key}`]);
      if (vals.length) state[key] = { type: 'text', values: vals };
    } else if (col.type === 'date') {
      const from = String(query[`cf_${key}_from`] || '').trim();
      const to = String(query[`cf_${key}_to`] || '').trim();
      if (from || to) state[key] = { type: 'date', from: from || null, to: to || null };
    } else if (col.type === 'number') {
      const op = String(query[`cf_${key}_op`] || 'between').trim().toLowerCase();
      const minRaw = query[`cf_${key}_min`];
      const maxRaw = query[`cf_${key}_max`];
      const min = minRaw !== undefined && minRaw !== '' ? Number(minRaw) : null;
      const max = maxRaw !== undefined && maxRaw !== '' ? Number(maxRaw) : null;
      const eq = query[`cf_${key}_eq`] !== undefined && query[`cf_${key}_eq`] !== ''
        ? Number(query[`cf_${key}_eq`])
        : null;
      if (eq != null && !Number.isNaN(eq)) {
        state[key] = { type: 'number', op: 'eq', eq };
      } else if ((min != null && !Number.isNaN(min)) || (max != null && !Number.isNaN(max))) {
        state[key] = {
          type: 'number',
          op: ['eq', 'gt', 'gte', 'lt', 'lte', 'between'].includes(op) ? op : 'between',
          min: min != null && !Number.isNaN(min) ? min : null,
          max: max != null && !Number.isNaN(max) ? max : null,
        };
      }
    }
  });
  return state;
}

function appendTextFilter(clauses, params, expr, values) {
  if (!values?.length) return;
  const normalized = values.map((v) => (v === '(Blank)' ? '' : v));
  params.push(normalized);
  clauses.push(`${expr} = ANY($${params.length}::text[])`);
}

function appendDateFilter(clauses, params, expr, { from, to }) {
  if (from) {
    params.push(from);
    clauses.push(`${expr} >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    clauses.push(`${expr} <= $${params.length}::date`);
  }
}

function appendNumberFilter(clauses, params, expr, filter) {
  const { op, min, max, eq } = filter;
  if (op === 'eq' && eq != null) {
    params.push(eq);
    clauses.push(`${expr} = $${params.length}::numeric`);
    return;
  }
  if (op === 'gt' && min != null) {
    params.push(min);
    clauses.push(`${expr} > $${params.length}::numeric`);
    return;
  }
  if (op === 'gte' && min != null) {
    params.push(min);
    clauses.push(`${expr} >= $${params.length}::numeric`);
    return;
  }
  if (op === 'lt' && max != null) {
    params.push(max);
    clauses.push(`${expr} < $${params.length}::numeric`);
    return;
  }
  if (op === 'lte' && max != null) {
    params.push(max);
    clauses.push(`${expr} <= $${params.length}::numeric`);
    return;
  }
  if (min != null) {
    params.push(min);
    clauses.push(`${expr} >= $${params.length}::numeric`);
  }
  if (max != null) {
    params.push(max);
    clauses.push(`${expr} <= $${params.length}::numeric`);
  }
}

function appendColumnFilters(base, query, { excludeColumn } = {}) {
  const state = readColumnFilterState(query);
  const extraClauses = [];
  Object.entries(state).forEach(([key, filter]) => {
    if (excludeColumn && key === excludeColumn) return;
    const col = getColumnDef(key);
    if (!col) return;
    if (filter.type === 'text') appendTextFilter(extraClauses, base.params, col.expr, filter.values);
    else if (filter.type === 'date') appendDateFilter(extraClauses, base.params, col.expr, filter);
    else if (filter.type === 'number') appendNumberFilter(extraClauses, base.params, col.expr, filter);
  });
  if (!extraClauses.length) return base;
  return {
    ...base,
    whereSql: `${base.whereSql} AND ${extraClauses.join(' AND ')}`,
  };
}

async function getColumnDistinctValues(pool, { fromSql, joinSql, whereSql, params }, columnKey) {
  const col = getColumnDef(columnKey);
  if (!col) return [];
  const res = await pool.query(
    `SELECT DISTINCT ${col.expr} AS val
     ${fromSql}
     ${joinSql || ''}
     ${whereSql}
     ORDER BY val ASC NULLS FIRST
     LIMIT 500`,
    params
  );
  return res.rows.map((r) => {
    const v = r.val;
    if (v == null || v === '') return '(Blank)';
    if (col.type === 'date') return String(v).slice(0, 10);
    if (col.type === 'number') return String(Number(v));
    return String(v);
  });
}

module.exports = {
  COLUMNS,
  columnKeys,
  getColumnDef,
  readColumnFilterState,
  appendColumnFilters,
  getColumnDistinctValues,
};
