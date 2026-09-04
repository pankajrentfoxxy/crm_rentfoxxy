/**
 * Google Sheets-style column filters for Return Master Data laptop list.
 */
const { parseCsvQuery } = require('../utils/dateRangeFilter');
const { DEPLOYED_WITH_CUSTOMER_STATUSES } = require('./customerDeployedAssets');
const { locationLabelSql } = require('./masterVendorDataService');

const CUSTOMER_STATUSES = DEPLOYED_WITH_CUSTOMER_STATUSES;

const CUSTOMER_SQL = CUSTOMER_STATUSES.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ');

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

const RETURN_TYPE_LABEL_EXPR = `
  CASE (${RETURN_TYPE_SQL})
    WHEN 'customer_return' THEN 'Customer Return'
    WHEN 'repair_pickup' THEN 'Repair Pickup'
    WHEN 'replacement_return' THEN 'Replacement Return'
    ELSE 'Other Return'
  END
`;

const SPECS_EXPR = `TRIM(BOTH ' | ' FROM CONCAT_WS(' | ',
  NULLIF(TRIM(COALESCE(s.extra->>'processor', '')), ''),
  NULLIF(TRIM(COALESCE(s.extra->>'generation', '')), ''),
  NULLIF(TRIM(COALESCE(s.extra->>'ram', '')), ''),
  NULLIF(TRIM(COALESCE(s.extra->>'storage', s.extra->>'ssd', '')), ''),
  NULLIF(TRIM(COALESCE(s.extra->>'gpu', s.extra->>'graphics', '')), ''),
  NULLIF(TRIM(COALESCE(s.extra->>'screen_size', s.extra->>'screen', '')), '')
))`;

const BRAND_MODEL_EXPR = `TRIM(BOTH ' - ' FROM CONCAT_WS(' - ',
  NULLIF(TRIM(COALESCE(s.extra->>'brand', '')), ''),
  NULLIF(TRIM(COALESCE(s.extra->>'model', s.extra->>'model_name', '')), '')
))`;

const CUSTOMER_NAME_EXPR = `
  CASE
    WHEN s.inventory_status IN (${CUSTOMER_SQL}) THEN COALESCE(c.company_name, c.name, '')
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
  previous_customer_name: {
    key: 'previous_customer_name',
    type: 'text',
    expr: `COALESCE(rc.company_name, rc.name, '')`,
  },
  return_date: {
    key: 'return_date',
    type: 'date',
    expr: `(re.return_at)::date`,
  },
  return_dc_number: {
    key: 'return_dc_number',
    type: 'text',
    expr: `COALESCE(re.return_dc_number, '')`,
  },
  return_type: {
    key: 'return_type',
    type: 'text',
    expr: RETURN_TYPE_LABEL_EXPR,
  },
  brand_model: {
    key: 'brand_model',
    type: 'text',
    expr: `COALESCE(${BRAND_MODEL_EXPR}, '')`,
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
  current_stage: {
    key: 'current_stage',
    type: 'text',
    expr: `COALESCE(active_ticket.stage_name, '')`,
  },
  last_movement_date: {
    key: 'last_movement_date',
    type: 'date',
    expr: `(COALESCE(s.status_changed_at, s.updated_at, s.delivered_at, re.return_at))::date`,
  },
};

function columnKeys() {
  return Object.keys(COLUMNS);
}

function getColumnDef(key) {
  const col = COLUMNS[key];
  if (!col) return null;
  if (key === 'current_location') {
    return { ...col, expr: `COALESCE((${locationLabelSql()}), '')` };
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

async function getColumnDistinctValues(pool, { cteSql, fromSql, whereSql, params }, columnKey) {
  const col = getColumnDef(columnKey);
  if (!col) return [];
  const res = await pool.query(
    `${cteSql || ''} SELECT DISTINCT ${col.expr} AS val
     ${fromSql}
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
