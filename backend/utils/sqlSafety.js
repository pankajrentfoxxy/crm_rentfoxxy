/**
 * SQL safety helpers — allowlisted sort/column fragments only.
 * Never interpolate raw request values into SQL text.
 */

function pickSortColumn(raw, allowlist, fallback) {
  const key = String(raw || '').trim();
  return allowlist[key] || allowlist[fallback] || Object.values(allowlist)[0];
}

function pickSortDirection(raw) {
  return String(raw || '').trim().toLowerCase() === 'desc' ? 'DESC' : 'ASC';
}

function buildWhereAnd(params, conditions) {
  const clauses = conditions.filter(Boolean);
  if (!clauses.length) return { whereSql: '', params };
  return { whereSql: `WHERE ${clauses.join(' AND ')}`, params };
}

module.exports = {
  pickSortColumn,
  pickSortDirection,
  buildWhereAnd,
};
