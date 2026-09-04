/**
 * Google Sheets-style column filters for Return DC list (/sales-pipeline/return-dc).
 */
const { parseCsvQuery } = require('../utils/dateRangeFilter');

/** @type {Record<string, { key: string, type: 'text'|'date'|'number', expr: string }>} */
const COLUMNS = {
  return_dc_number: {
    key: 'return_dc_number',
    type: 'text',
    expr: `COALESCE(return_dc_number, '')`,
  },
  created_at: {
    key: 'created_at',
    type: 'date',
    expr: `(created_at)::date`,
  },
  pickup_date: {
    key: 'pickup_date',
    type: 'date',
    expr: `(pickup_date)::date`,
  },
  customer_name: {
    key: 'customer_name',
    type: 'text',
    expr: `COALESCE(customer_name, '')`,
  },
  city: {
    key: 'city',
    type: 'text',
    expr: `COALESCE(city, '')`,
  },
  unit_count: {
    key: 'unit_count',
    type: 'number',
    expr: `COALESCE(unit_count, 0)::numeric`,
  },
  original_dc_number: {
    key: 'original_dc_number',
    type: 'text',
    expr: `COALESCE(original_dc_number, '')`,
  },
  sales_order_number: {
    key: 'sales_order_number',
    type: 'text',
    expr: `COALESCE(sales_order_number, '')`,
  },
  reason: {
    key: 'reason',
    type: 'text',
    expr: `COALESCE(reason, '')`,
  },
  status: {
    key: 'status',
    type: 'text',
    expr: `COALESCE(status, '')`,
  },
  warehouse: {
    key: 'warehouse',
    type: 'text',
    expr: `CASE WHEN warehouse_receive_pending THEN 'Receive pending' ELSE 'Received' END`,
  },
};

function columnKeys() {
  return Object.keys(COLUMNS);
}

function getColumnDef(key) {
  return COLUMNS[key] || null;
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

async function getColumnDistinctValues(pool, { cteSql, whereSql, params }, columnKey) {
  const col = getColumnDef(columnKey);
  if (!col) return [];
  const res = await pool.query(
    `${cteSql}
     SELECT DISTINCT ${col.expr} AS val
     FROM rdc_list
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
