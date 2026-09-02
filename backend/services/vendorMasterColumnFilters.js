/**
 * Google Sheets-style column filters for Vendor Master laptop list.
 */
const { parseCsvQuery } = require('../utils/dateRangeFilter');

const VENDOR_NAME_EXPR = `COALESCE(v.business_name, TRIM(CONCAT(COALESCE(v.first_name,''), ' ', COALESCE(v.last_name,''))))`;

const SPECS_EXPR = `TRIM(BOTH ' | ' FROM CONCAT_WS(' | ',
  NULLIF(TRIM(COALESCE(s.extra->>'processor', '')), ''),
  NULLIF(TRIM(COALESCE(s.extra->>'generation', '')), ''),
  NULLIF(TRIM(COALESCE(s.extra->>'ram', '')), ''),
  NULLIF(TRIM(COALESCE(s.extra->>'storage', s.extra->>'ssd', '')), ''),
  NULLIF(TRIM(COALESCE(s.extra->>'gpu', s.extra->>'graphics', '')), ''),
  NULLIF(TRIM(COALESCE(s.extra->>'screen_size', s.extra->>'screen', '')), '')
))`;

const SO_DC_EXPR = `NULLIF(TRIM(CONCAT_WS(' / ',
  NULLIF(TRIM(COALESCE(sos.sales_order_number, '')), ''),
  NULLIF(TRIM(COALESCE(s.current_dc_number, sos.dc_number, '')), '')
)), '')`;

const SALE_RENT_EXPR = `CASE
  WHEN sos.sales_order_number IS NOT NULL AND LOWER(COALESCE(sos.quotation_type, '')) LIKE '%sale%' THEN COALESCE(sos.so_rate, 0)::text
  WHEN s.rent_monthly_rate IS NOT NULL THEN CONCAT(COALESCE(s.rent_monthly_rate, 0)::text, '/mo')
  WHEN sos.so_rate IS NOT NULL THEN CONCAT(COALESCE(sos.so_rate, 0)::text, '/mo')
  ELSE ''
END`;

/** @type {Record<string, { key: string, type: 'text'|'date'|'number', expr: string, label?: string }>} */
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
  vendor_name: {
    key: 'vendor_name',
    type: 'text',
    expr: `COALESCE(${VENDOR_NAME_EXPR}, '')`,
  },
  purchase_date: {
    key: 'purchase_date',
    type: 'date',
    expr: 'p.purchase_order_date',
  },
  purchase_order_number: {
    key: 'purchase_order_number',
    type: 'text',
    expr: `COALESCE(p.purchase_order_number, '')`,
  },
  purchase_rate: {
    key: 'purchase_rate',
    type: 'number',
    expr: 'COALESCE(vpd.purchase_rate, 0)',
  },
  brand: {
    key: 'brand',
    type: 'text',
    expr: `COALESCE(NULLIF(TRIM(s.extra->>'brand'), ''), '')`,
  },
  model: {
    key: 'model',
    type: 'text',
    expr: `COALESCE(NULLIF(TRIM(COALESCE(s.extra->>'model', s.extra->>'model_name')), ''), '')`,
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
  location_label: {
    key: 'location_label',
    type: 'text',
    expr: '', // filled at runtime from locationLabelSql()
  },
  current_stage: {
    key: 'current_stage',
    type: 'text',
    expr: `COALESCE(active_ticket.stage_name, '')`,
  },
  customer_name: {
    key: 'customer_name',
    type: 'text',
    expr: `COALESCE(c.company_name, c.name, '')`,
  },
  so_dc: {
    key: 'so_dc',
    type: 'text',
    expr: `COALESCE(${SO_DC_EXPR}, '')`,
  },
  sale_rent: {
    key: 'sale_rent',
    type: 'text',
    expr: `COALESCE(${SALE_RENT_EXPR}, '')`,
  },
  last_movement_date: {
    key: 'last_movement_date',
    type: 'date',
    expr: `(COALESCE(s.delivered_at, s.updated_at))::date`,
  },
};

function columnKeys() {
  return Object.keys(COLUMNS);
}

function getColumnDef(key, locationLabelSql) {
  const col = COLUMNS[key];
  if (!col) return null;
  if (key === 'location_label' && locationLabelSql) {
    return { ...col, expr: `COALESCE((${locationLabelSql}), '')` };
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

/**
 * Append column-filter AND clauses. Mutates params array.
 * @param {{ whereSql: string, params: unknown[] }} base
 * @param {object} query
 * @param {{ excludeColumn?: string, locationLabelSql?: string }} opts
 */
function appendColumnFilters(base, query, { excludeColumn, locationLabelSql } = {}) {
  const state = readColumnFilterState(query);
  const extraClauses = [];
  Object.entries(state).forEach(([key, filter]) => {
    if (excludeColumn && key === excludeColumn) return;
    const col = getColumnDef(key, locationLabelSql);
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

function columnFilterParamsForApi(state = {}) {
  const params = {};
  Object.entries(state).forEach(([key, filter]) => {
    if (filter.type === 'text' && filter.values?.length) {
      params[`cf_${key}`] = filter.values.join(',');
    } else if (filter.type === 'date') {
      if (filter.from) params[`cf_${key}_from`] = filter.from;
      if (filter.to) params[`cf_${key}_to`] = filter.to;
    } else if (filter.type === 'number') {
      if (filter.op === 'eq' && filter.eq != null) params[`cf_${key}_eq`] = String(filter.eq);
      else {
        if (filter.op) params[`cf_${key}_op`] = filter.op;
        if (filter.min != null) params[`cf_${key}_min`] = String(filter.min);
        if (filter.max != null) params[`cf_${key}_max`] = String(filter.max);
      }
    }
  });
  return params;
}

async function getColumnDistinctValues(pool, { cteSql, fromSql, joinSql, whereSql, params }, columnKey, locationLabelSql) {
  const col = getColumnDef(columnKey, locationLabelSql);
  if (!col) return [];
  const res = await pool.query(
    `${cteSql || ''} SELECT DISTINCT ${col.expr} AS val
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
  columnFilterParamsForApi,
  getColumnDistinctValues,
};
