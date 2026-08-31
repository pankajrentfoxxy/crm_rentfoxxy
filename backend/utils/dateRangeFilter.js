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
function appendDateRangeClauses({
  column,
  expr,
  dateFrom,
  dateTo,
  params,
  tableAlias = null,
  timezone = null,
}) {
  const col = expr || (tableAlias ? `${tableAlias}.${column}` : column);
  const clauses = [];
  const fromYmd = String(dateFrom || '').trim();
  const toYmd = String(dateTo || '').trim();

  if (timezone && (fromYmd || toYmd)) {
    if (fromYmd) {
      params.push(fromYmd);
      clauses.push(`(${col} AT TIME ZONE '${timezone}')::date >= $${params.length}::date`);
    }
    if (toYmd) {
      params.push(toYmd);
      clauses.push(`(${col} AT TIME ZONE '${timezone}')::date <= $${params.length}::date`);
    }
    return clauses;
  }

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

/** YYYY-MM → first/last calendar day of that month. */
function resolveMonthRange(monthYmd) {
  const m = String(monthYmd || '').trim().match(/^(\d{4})-(\d{2})$/);
  if (!m) return { dateFrom: null, dateTo: null };
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return { dateFrom: null, dateTo: null };
  const lastDay = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, '0');
  return {
    dateFrom: `${year}-${mm}-01`,
    dateTo: `${year}-${mm}-${String(lastDay).padStart(2, '0')}`,
  };
}

function parseCsvQuery(raw) {
  if (raw == null || raw === '') return [];
  const parts = Array.isArray(raw)
    ? raw.flatMap((v) => String(v || '').split(','))
    : String(raw).split(',');
  return [...new Set(parts.map((s) => s.trim()).filter(Boolean))];
}

/**
 * Master-data style date resolution: month preset or explicit from/to.
 * Legacy URLs with only date_from/date_to are treated as custom range.
 * `month` accepts one or more YYYY-MM values (comma-separated).
 */
function resolveMasterDateRange(query = {}) {
  const mode = String(query.date_mode || query.dateMode || '').trim().toLowerCase();
  const months = parseCsvQuery(query.month);
  if (mode === 'month' && months.length) {
    const ranges = months.map(resolveMonthRange).filter((r) => r.dateFrom);
    if (!ranges.length) {
      return { dateFrom: null, dateTo: null, dateMode: 'month', month: months.join(','), months, ranges: [] };
    }
    return {
      dateFrom: ranges[0].dateFrom,
      dateTo: ranges[ranges.length - 1].dateTo,
      dateMode: 'month',
      month: months.join(','),
      months,
      ranges,
    };
  }
  const from = String(query.date_from || query.dateFrom || '').trim() || null;
  const to = String(query.date_to || query.dateTo || '').trim() || null;
  if (mode === 'range' || from || to) {
    return { dateFrom: from, dateTo: to, dateMode: 'range', month: null, months: [], ranges: [] };
  }
  return { dateFrom: null, dateTo: null, dateMode: null, month: null, months: [], ranges: [] };
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
  resolveMonthRange,
  resolveMasterDateRange,
  parseCsvQuery,
};
