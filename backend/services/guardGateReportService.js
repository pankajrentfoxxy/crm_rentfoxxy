/**
 * Admin / super-admin warehouse gate report (inward + outward laptop scans).
 * Guard role remains scoped to their own scans on the mobile dashboard.
 */
const pool = require('../config/db');
const {
  appendDateRangeClauses,
  parseCsvQuery,
  resolveDatePeriod,
} = require('../utils/dateRangeFilter');

const TZ = 'Asia/Kolkata';

const COLUMNS = {
  scan_time: {
    type: 'date',
    expr: `(gm.scan_time AT TIME ZONE '${TZ}')::date`,
  },
  direction: { type: 'text', expr: "COALESCE(gm.direction, '')" },
  ttspl: { type: 'text', expr: "COALESCE(gm.ttspl, '')" },
  serial_number: { type: 'text', expr: "COALESCE(gm.serial_number, '')" },
  brand: { type: 'text', expr: "COALESCE(vsn.extra->>'brand', '')" },
  model: {
    type: 'text',
    expr: "COALESCE(NULLIF(vsn.extra->>'model', ''), NULLIF(vsn.extra->>'model_name', ''), '')",
  },
  source_type: { type: 'text', expr: "COALESCE(gm.source_type, '')" },
  reference_number: { type: 'text', expr: "COALESCE(gm.reference_number, '')" },
  awb_number: { type: 'text', expr: "COALESCE(gm.awb_number, '')" },
  guard_name: { type: 'text', expr: "COALESCE(gm.guard_name, '')" },
  validation_result: { type: 'text', expr: "COALESCE(gm.validation_result, '')" },
};

const FROM_SQL = `
  FROM gate_movements gm
  LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = gm.serial_id
`;

function isGuardScoped(role) {
  return String(role || '').toLowerCase() === 'guard';
}

function readColumnFilterState(query = {}) {
  const state = {};
  Object.entries(COLUMNS).forEach(([key, col]) => {
    if (col.type === 'text') {
      const vals = parseCsvQuery(query[`cf_${key}`]);
      if (vals.length) state[key] = { type: 'text', values: vals };
    } else if (col.type === 'date') {
      const from = String(query[`cf_${key}_from`] || '').trim();
      const to = String(query[`cf_${key}_to`] || '').trim();
      if (from || to) state[key] = { type: 'date', from: from || null, to: to || null };
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

function appendColumnFilters(clauses, params, query, { excludeColumn } = {}) {
  const state = readColumnFilterState(query);
  Object.entries(state).forEach(([key, filter]) => {
    if (excludeColumn && key === excludeColumn) return;
    const col = COLUMNS[key];
    if (!col) return;
    if (filter.type === 'text') appendTextFilter(clauses, params, col.expr, filter.values);
    else if (filter.type === 'date') appendDateFilter(clauses, params, col.expr, filter);
  });
}

function buildBaseFilters({
  userId,
  role,
  period,
  dateFrom,
  dateTo,
  search,
  direction,
  query,
  excludeColumn,
} = {}) {
  const params = [];
  const clauses = [];

  if (isGuardScoped(role) && userId) {
    params.push(userId);
    clauses.push(`gm.guard_user_id = $${params.length}`);
  }

  const resolved = resolveDatePeriod({
    period,
    dateFrom,
    dateTo,
  });
  const rangeClauses = appendDateRangeClauses({
    expr: 'gm.scan_time',
    dateFrom: resolved.dateFrom,
    dateTo: resolved.dateTo,
    params,
    timezone: TZ,
  });
  clauses.push(...rangeClauses);

  const dir = String(direction || '').toLowerCase();
  if (dir === 'inward' || dir === 'outward') {
    params.push(dir);
    clauses.push(`gm.direction = $${params.length}`);
  }

  const q = String(search || '').trim();
  if (q) {
    params.push(`%${q}%`);
    const p = params.length;
    clauses.push(`(
      COALESCE(gm.ttspl, '') ILIKE $${p}
      OR COALESCE(gm.serial_number, '') ILIKE $${p}
      OR COALESCE(gm.reference_number, '') ILIKE $${p}
      OR COALESCE(gm.awb_number, '') ILIKE $${p}
      OR COALESCE(gm.guard_name, '') ILIKE $${p}
      OR COALESCE(gm.source_type, '') ILIKE $${p}
      OR COALESCE(vsn.extra->>'brand', '') ILIKE $${p}
      OR COALESCE(vsn.extra->>'model', '') ILIKE $${p}
    )`);
  }

  appendColumnFilters(clauses, params, query || {}, { excludeColumn });

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return { params, where, resolved };
}

async function getReport(opts = {}) {
  const page = Math.max(1, parseInt(opts.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(opts.limit, 10) || 50));
  const offset = (page - 1) * limit;

  const { params, where, resolved } = buildBaseFilters(opts);

  const stats = await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE gm.validation_result = 'valid' AND gm.direction = 'inward')::int AS inward,
        COUNT(*) FILTER (WHERE gm.validation_result = 'valid' AND gm.direction = 'outward')::int AS outward,
        COUNT(*) FILTER (WHERE gm.validation_result = 'invalid')::int AS invalid,
        COUNT(*)::int AS total_scans
       ${FROM_SQL}
       ${where}`,
    params
  );

  const pendingParams = [];
  let pendingWhere = "status = 'open'";
  if (isGuardScoped(opts.role) && opts.userId) {
    pendingParams.push(opts.userId);
    pendingWhere += ` AND guard_user_id = $${pendingParams.length}`;
  }
  const pending = await pool.query(
    `SELECT COUNT(*)::int AS n FROM gate_scan_sessions WHERE ${pendingWhere}`,
    pendingParams
  );

  const count = await pool.query(
    `SELECT COUNT(*)::int AS n ${FROM_SQL} ${where}`,
    params
  );
  const total = count.rows[0]?.n || 0;

  const listParams = [...params, limit, offset];
  const rows = await pool.query(
    `SELECT
        gm.id,
        gm.scan_time,
        gm.direction,
        gm.source_type,
        gm.reference_type,
        gm.reference_number,
        gm.ttspl,
        gm.serial_number,
        gm.awb_number,
        gm.validation_result,
        gm.validation_message,
        gm.guard_name,
        gm.confirmed_at,
        COALESCE(vsn.extra->>'brand', '') AS brand,
        COALESCE(NULLIF(vsn.extra->>'model', ''), NULLIF(vsn.extra->>'model_name', ''), '') AS model,
        COALESCE(vsn.extra->>'processor', '') AS processor,
        COALESCE(vsn.extra->>'generation', '') AS generation,
        COALESCE(vsn.extra->>'ram', '') AS ram,
        COALESCE(vsn.extra->>'storage', '') AS storage
       ${FROM_SQL}
       ${where}
       ORDER BY gm.scan_time DESC, gm.id DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
    listParams
  );

  const s = stats.rows[0] || {};
  return {
    period: resolved.period,
    date_from: resolved.dateFrom,
    date_to: resolved.dateTo,
    inward: s.inward || 0,
    outward: s.outward || 0,
    invalid: s.invalid || 0,
    total_scans: s.total_scans || 0,
    pending_validation: pending.rows[0]?.n || 0,
    rows: rows.rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

async function getColumnValues(opts = {}) {
  const column = String(opts.column || '').trim();
  const col = COLUMNS[column];
  if (!col || col.type !== 'text') {
    return [];
  }
  const { params, where } = buildBaseFilters({ ...opts, excludeColumn: column });
  const r = await pool.query(
    `SELECT DISTINCT ${col.expr} AS value
       ${FROM_SQL}
       ${where}
       ORDER BY 1 ASC NULLS LAST
       LIMIT 400`,
    params
  );
  return r.rows.map((row) => (row.value == null || row.value === '' ? '(Blank)' : String(row.value)));
}

module.exports = {
  getReport,
  getColumnValues,
  COLUMNS,
};
