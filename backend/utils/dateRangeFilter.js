function parseDateFrom(dateFrom) {
  const v = (dateFrom || '').trim();
  return v ? `${v}T00:00:00.000Z` : null;
}

function parseDateTo(dateTo) {
  const v = (dateTo || '').trim();
  return v ? `${v}T23:59:59.999Z` : null;
}

/** Local calendar YYYY-MM-DD (avoids UTC day-shift from toISOString). */
function localYmd(offsetDays = 0) {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + Number(offsetDays || 0));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Resolve period presets used by DateRangeFilter UIs.
 * period/date: today | yesterday | all
 * Or custom date_from / date_to (YYYY-MM-DD).
 * Explicit period today/yesterday wins over raw from/to.
 */
function resolveDatePeriod({ period, date, dateFrom, dateTo } = {}) {
  const preset = String(period || date || '').trim().toLowerCase();
  const from = String(dateFrom || '').trim() || null;
  const to = String(dateTo || '').trim() || null;

  if (preset === 'all') {
    return { period: 'all', dateFrom: null, dateTo: null };
  }
  if (preset === 'today') {
    const d = localYmd(0);
    return { period: 'today', dateFrom: d, dateTo: d };
  }
  if (preset === 'yesterday') {
    const d = localYmd(-1);
    return { period: 'yesterday', dateFrom: d, dateTo: d };
  }
  if (from || to) {
    return { period: 'custom', dateFrom: from, dateTo: to };
  }
  return { period: 'all', dateFrom: null, dateTo: null };
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
  localYmd,
  resolveDatePeriod,
};
