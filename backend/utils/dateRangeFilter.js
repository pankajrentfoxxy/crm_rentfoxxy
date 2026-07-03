function parseDateFrom(dateFrom) {
  const v = (dateFrom || '').trim();
  return v ? `${v}T00:00:00.000Z` : null;
}

function parseDateTo(dateTo) {
  const v = (dateTo || '').trim();
  return v ? `${v}T23:59:59.999Z` : null;
}

/** Returns SQL AND fragments for a timestamp column/expression. Mutates params. */
function appendDateRangeClauses({ column, expr, dateFrom, dateTo, params, tableAlias = null }) {
  const col = expr || (tableAlias ? `${tableAlias}.${column}` : column);
  const clauses = [];
  const from = parseDateFrom(dateFrom);
  const to = parseDateTo(dateTo);
  if (from) {
    params.push(from);
    clauses.push(`${col} >= $${params.length}::timestamptz`);
  }
  if (to) {
    params.push(to);
    clauses.push(`${col} <= $${params.length}::timestamptz`);
  }
  return clauses;
}

function appendDateRangeToWhere(where, clauses) {
  if (!clauses?.length) return where;
  const joiner = clauses.join(' AND ');
  if (!where) return `WHERE ${joiner}`;
  return `${where} AND ${joiner}`;
}

module.exports = {
  appendDateRangeClauses,
  appendDateRangeToWhere,
  parseDateFrom,
  parseDateTo,
};
