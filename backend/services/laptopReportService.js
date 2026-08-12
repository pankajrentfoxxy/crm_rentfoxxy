const pool = require('../config/db');
const { parseMultiSpecValues } = require('../utils/inventorySpecFilter');

const PROCESSOR_BUCKETS_SHORT = ['i3', 'i5', 'i7', 'i9', 'Ryzen 3', 'Ryzen 5', 'Ryzen 7', 'Others'];

const REPORT_STAGES = [
  { key: 'floormanager', label: 'Floor Manager', names: ['Floor Manager'] },
  { key: 'qcqueue', label: 'QC Queue', names: ['QC1', 'QC2'] },
  { key: 'diagnosis', label: 'Diagnosis', names: ['Diagnosis'] },
  { key: 'assembly', label: 'Assembly & Software', names: ['Assembly & Software'] },
  { key: 'testing', label: 'Final Testing', names: ['Final Testing'] },
  { key: 'chip', label: 'Chip Level Repair', names: ['Chip Level Repair'] },
  { key: 'paint', label: 'Body & Paint', names: ['Body & Paint'] },
  { key: 'qc1', label: 'QC1', names: ['QC1'] },
  { key: 'qc2', label: 'QC2', names: ['QC2'] },
  { key: 'dispatchqc', label: 'Dispatch QC', names: ['Dispatch QC'] },
  { key: 'inventory', label: 'Inventory', names: ['Inventory'] },
];

const DISPLAY_STATUS_SQL = `
  CASE
    WHEN t.status = 'completed' THEN 'Done'
    WHEN t.status = 'diagnosis_failed' THEN 'Diagnosis Failed'
    WHEN t.status = 'qc_failed_return_vendor'
      OR (t.status = 'failed' AND COALESCE(t.qc_fail_count, 0) > 0) THEN 'QC Failed'
    WHEN t.status = 'in_progress' AND COALESCE(s.stage_name, '') = 'Floor Manager' THEN 'Pending'
    WHEN t.status = 'in_progress' THEN 'In Progress'
    ELSE 'Pending'
  END
`;

const TICKET_FROM_SQL = `
  FROM tickets t
  LEFT JOIN stages s ON s.stage_id = t.current_stage_id
  LEFT JOIN teams tm ON tm.team_id = t.assigned_team_id
  LEFT JOIN users u ON u.user_id = t.assigned_user_id
  LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = t.vendor_serial_id AND vsn.deleted_at IS NULL
`;

function istDateString(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return istDateString(d);
}

function resolvePeriodRange(query = {}) {
  const mode = String(query.dateMode || query.period || 'today').toLowerCase();
  const today = istDateString();

  if (mode === 'all') {
    return { from: null, to: null, period: 'all' };
  }
  if (mode === 'yesterday') {
    const y = addDays(today, -1);
    return { from: y, to: y, period: 'yesterday' };
  }
  if (mode === 'today') {
    return { from: today, to: today, period: 'today' };
  }
  if (mode === 'last_7_days' || mode === 'last7') {
    return { from: addDays(today, -6), to: today, period: 'last_7_days' };
  }
  if (mode === 'last_30_days' || mode === 'last30') {
    return { from: addDays(today, -29), to: today, period: 'last_30_days' };
  }
  if (mode === 'custom') {
    return {
      from: String(query.dateFrom || query.from || today),
      to: String(query.dateTo || query.to || today),
      period: 'custom',
    };
  }
  return { from: today, to: today, period: 'today' };
}

function bucketProcessorShort(processor) {
  const p = String(processor || '').toLowerCase().replace(/\s+/g, ' ');
  if (/\bryzen\s*3\b|\bryzen3\b/.test(p)) return 'Ryzen 3';
  if (/\bryzen\s*5\b|\bryzen5\b/.test(p)) return 'Ryzen 5';
  if (/\bryzen\s*7\b|\bryzen7\b/.test(p)) return 'Ryzen 7';
  if (/\bi\s*3\b|\bcore\s*i3\b|\bi3\b/.test(p)) return 'i3';
  if (/\bi\s*5\b|\bcore\s*i5\b|\bi5\b/.test(p)) return 'i5';
  if (/\bi\s*7\b|\bcore\s*i7\b|\bi7\b/.test(p)) return 'i7';
  if (/\bi\s*9\b|\bcore\s*i9\b|\bi9\b/.test(p)) return 'i9';
  return 'Others';
}

function stageDefForKey(key) {
  return REPORT_STAGES.find((s) => s.key === key) || null;
}

function stageDefForLabel(label) {
  return REPORT_STAGES.find((s) => s.label === label) || null;
}

function processorBucketSql(proc) {
  const p = String(proc).trim();
  if (p === 'i3') return `COALESCE(t.processor, '') ~* 'i\\s*3|core\\s*i3|\\bi3\\b'`;
  if (p === 'i5') return `COALESCE(t.processor, '') ~* 'i\\s*5|core\\s*i5|\\bi5\\b'`;
  if (p === 'i7') return `COALESCE(t.processor, '') ~* 'i\\s*7|core\\s*i7|\\bi7\\b'`;
  if (p === 'i9') return `COALESCE(t.processor, '') ~* 'i\\s*9|core\\s*i9|\\bi9\\b'`;
  if (p === 'Ryzen 3') return `COALESCE(t.processor, '') ~* 'ryzen\\s*3|ryzen3'`;
  if (p === 'Ryzen 5') return `COALESCE(t.processor, '') ~* 'ryzen\\s*5|ryzen5'`;
  if (p === 'Ryzen 7') return `COALESCE(t.processor, '') ~* 'ryzen\\s*7|ryzen7'`;
  if (p === 'Others') {
    return `NOT (COALESCE(t.processor, '') ~* 'i\\s*[3579]|core\\s*i[3579]|ryzen\\s*[357]|ryzen[357]')`;
  }
  return null;
}

function appendMultiIlike(values, fieldExpr, conditions, params, idx) {
  if (!values.length) return idx;
  const parts = [];
  for (const val of values) {
    params.push(`%${val}%`);
    parts.push(`${fieldExpr} ILIKE $${idx}`);
    idx += 1;
  }
  conditions.push(`(${parts.join(' OR ')})`);
  return idx;
}

function appendMultiProcessor(raw, conditions, params, idx) {
  const vals = parseMultiSpecValues(raw).filter((v) => v !== 'All');
  if (!vals.length) return idx;
  const parts = [];
  for (const val of vals) {
    const bucket = processorBucketSql(val);
    if (bucket) {
      parts.push(bucket);
    } else {
      params.push(`%${val}%`);
      parts.push(`COALESCE(t.processor, '') ILIKE $${idx}`);
      idx += 1;
    }
  }
  if (parts.length) conditions.push(`(${parts.join(' OR ')})`);
  return idx;
}

function buildTicketFilters(query) {
  const conditions = [`t.status NOT IN ('cancelled')`];
  const params = [];
  let idx = 1;

  const { from, to } = resolvePeriodRange(query);
  if (from && to) {
    conditions.push(`t.created_at >= $${idx}::date`);
    params.push(from);
    idx += 1;
    conditions.push(`t.created_at < ($${idx}::date + interval '1 day')`);
    params.push(to);
    idx += 1;
  }

  const stageKey = query.stage_key || query.popup_stage_key;
  const stageLabel = query.stage || query.stage_name;
  if (stageKey) {
    const def = stageDefForKey(String(stageKey));
    if (def) {
      conditions.push(`s.stage_name = ANY($${idx}::text[])`);
      params.push(def.names);
      idx += 1;
    }
  } else if (stageLabel && stageLabel !== 'All') {
    const labels = parseMultiSpecValues(stageLabel).filter((v) => v !== 'All');
    if (labels.length) {
      const stageNames = [];
      for (const label of labels) {
        const def = stageDefForLabel(String(label));
        if (def) stageNames.push(...def.names);
        else stageNames.push(String(label));
      }
      conditions.push(`s.stage_name = ANY($${idx}::text[])`);
      params.push([...new Set(stageNames)]);
      idx += 1;
    }
  }

  if (query.stage_id) {
    const sid = parseInt(query.stage_id, 10);
    if (Number.isInteger(sid)) {
      conditions.push(`t.current_stage_id = $${idx}`);
      params.push(sid);
      idx += 1;
    }
  }

  const teamName = query.team;
  if (teamName && teamName !== 'All') {
    const teams = parseMultiSpecValues(teamName).filter((v) => v !== 'All');
    if (teams.length) {
      conditions.push(`tm.team_name = ANY($${idx}::text[])`);
      params.push(teams);
      idx += 1;
    }
  } else if (query.team_id) {
    const tid = parseInt(query.team_id, 10);
    if (Number.isInteger(tid)) {
      conditions.push(`t.assigned_team_id = $${idx}`);
      params.push(tid);
      idx += 1;
    }
  }

  const techName = query.technician || query.popup_technician;
  if (techName && techName !== 'All') {
    const techs = parseMultiSpecValues(techName).filter((v) => v !== 'All');
    if (techs.length) {
      conditions.push(`u.name = ANY($${idx}::text[])`);
      params.push(techs);
      idx += 1;
    }
  } else if (query.user_id) {
    const uid = parseInt(query.user_id, 10);
    if (Number.isInteger(uid)) {
      conditions.push(`t.assigned_user_id = $${idx}`);
      params.push(uid);
      idx += 1;
    }
  }

  const displayStatus = query.display_status || query.status || query.popup_status;
  if (displayStatus && displayStatus !== 'All' && displayStatus !== 'Total') {
    const statuses = parseMultiSpecValues(displayStatus).filter((v) => v !== 'All' && v !== 'Total');
    if (statuses.length) {
      conditions.push(`${DISPLAY_STATUS_SQL} = ANY($${idx}::text[])`);
      params.push(statuses);
      idx += 1;
    }
  }

  const stageMode = query.popup_stage_mode;
  if (stageMode === 'done') {
    conditions.push(`${DISPLAY_STATUS_SQL} = 'Done'`);
  } else if (stageMode === 'pending') {
    conditions.push(`${DISPLAY_STATUS_SQL} <> 'Done'`);
  }

  const techMode = query.popup_tech_mode;
  if (techMode === 'inProgress') {
    conditions.push(`${DISPLAY_STATUS_SQL} = 'In Progress'`);
  } else if (techMode === 'done') {
    conditions.push(`${DISPLAY_STATUS_SQL} = 'Done'`);
  } else if (techMode === 'pending') {
    conditions.push(`${DISPLAY_STATUS_SQL} = 'Pending'`);
  }

  if (query.brand && query.brand !== 'All') {
    idx = appendMultiIlike(parseMultiSpecValues(query.brand), `COALESCE(t.brand, '')`, conditions, params, idx);
  }

  if (query.model && query.model !== 'All') {
    idx = appendMultiIlike(parseMultiSpecValues(query.model), `COALESCE(t.model, '')`, conditions, params, idx);
  }

  const procFilter = query.popup_processor || query.processor;
  if (procFilter && procFilter !== 'All') {
    idx = appendMultiProcessor(procFilter, conditions, params, idx);
  }

  if (query.generation && query.generation !== 'All') {
    idx = appendMultiIlike(
      parseMultiSpecValues(query.generation),
      `COALESCE(NULLIF(TRIM(vsn.extra->>'generation'), ''), '')`,
      conditions,
      params,
      idx
    );
  }

  if (query.ram && query.ram !== 'All') {
    idx = appendMultiIlike(parseMultiSpecValues(query.ram), `COALESCE(t.ram, '')`, conditions, params, idx);
  }

  if (query.ssd && query.ssd !== 'All') {
    idx = appendMultiIlike(parseMultiSpecValues(query.ssd), `COALESCE(t.storage, '')`, conditions, params, idx);
  }

  const searchRaw = query.search != null ? String(query.search).trim() : '';
  if (searchRaw) {
    const term = `%${searchRaw}%`;
    conditions.push(`(
      CAST(t.ticket_id AS TEXT) ILIKE $${idx}
      OR COALESCE(t.ttspl_id, '') ILIKE $${idx}
      OR COALESCE(t.serial_number, '') ILIKE $${idx}
      OR COALESCE(t.machine_number, '') ILIKE $${idx}
      OR COALESCE(vsn.serial_number, '') ILIKE $${idx}
      OR COALESCE(t.model, '') ILIKE $${idx}
    )`);
    params.push(term);
    idx += 1;
  }

  return {
    whereSql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
    idx,
  };
}

function formatDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function mapTicketRow(row) {
  return {
    ticketId: `TKT-${row.ticket_id}`,
    ticket_id: row.ticket_id,
    ttspl: row.ttspl || '—',
    serial: row.serial_number || '—',
    brand: row.brand || '—',
    model: row.model || '—',
    processor: row.processor || '—',
    generation: row.generation || '—',
    ram: row.ram || '—',
    ssd: row.ssd || '—',
    stage: row.current_stage || '—',
    stageKey: row.stage_key || '',
    tech: row.assigned_technician || 'Unassigned',
    team: row.team || '—',
    status: row.display_status || 'Pending',
    created: formatDateOnly(row.created_at),
  };
}

async function getFilterOptions() {
  const [stages, teams, technicians, brands, models, processors, generations, rams, ssds] = await Promise.all([
    pool.query(`SELECT stage_id, stage_name FROM stages ORDER BY stage_order`),
    pool.query(`SELECT team_id, team_name FROM teams ORDER BY team_name`),
    pool.query(
      `SELECT DISTINCT u.user_id, u.name
         FROM users u
         JOIN tickets t ON t.assigned_user_id = u.user_id
        WHERE COALESCE(u.active, true) = true
        ORDER BY u.name`
    ),
    pool.query(`SELECT DISTINCT TRIM(brand) AS v FROM tickets WHERE TRIM(COALESCE(brand, '')) <> '' ORDER BY 1`),
    pool.query(`SELECT DISTINCT TRIM(model) AS v FROM tickets WHERE TRIM(COALESCE(model, '')) <> '' ORDER BY 1`),
    pool.query(`SELECT DISTINCT TRIM(processor) AS v FROM tickets WHERE TRIM(COALESCE(processor, '')) <> '' ORDER BY 1`),
    pool.query(
      `SELECT DISTINCT TRIM(vsn.extra->>'generation') AS v
         FROM tickets t
         JOIN vendor_serial_numbers vsn ON vsn.serial_id = t.vendor_serial_id AND vsn.deleted_at IS NULL
        WHERE TRIM(COALESCE(vsn.extra->>'generation', '')) <> ''
        ORDER BY 1`
    ),
    pool.query(`SELECT DISTINCT TRIM(ram) AS v FROM tickets WHERE TRIM(COALESCE(ram, '')) <> '' ORDER BY 1`),
    pool.query(`SELECT DISTINCT TRIM(storage) AS v FROM tickets WHERE TRIM(COALESCE(storage, '')) <> '' ORDER BY 1`),
  ]);

  return {
    stages: REPORT_STAGES.map((s) => ({ key: s.key, label: s.label })),
    db_stages: stages.rows,
    teams: teams.rows.map((r) => r.team_name),
    technicians: technicians.rows.map((r) => r.name),
    brands: brands.rows.map((r) => r.v),
    models: models.rows.map((r) => r.v),
    processors: PROCESSOR_BUCKETS_SHORT,
    generations: generations.rows.map((r) => r.v),
    rams: rams.rows.map((r) => r.v),
    ssds: ssds.rows.map((r) => r.v),
    statuses: ['Pending', 'In Progress', 'Done', 'QC Failed', 'Diagnosis Failed'],
  };
}

async function getSummaryCounts(query) {
  const { whereSql, params } = buildTicketFilters(query);
  const res = await pool.query(
    `SELECT ${DISPLAY_STATUS_SQL} AS display_status, COUNT(*)::int AS cnt
     ${TICKET_FROM_SQL}
     ${whereSql}
     GROUP BY 1`,
    params
  );
  const counts = {
    Total: 0,
    Pending: 0,
    'In Progress': 0,
    Done: 0,
    'QC Failed': 0,
    'Diagnosis Failed': 0,
  };
  for (const row of res.rows) {
    counts[row.display_status] = (counts[row.display_status] || 0) + row.cnt;
    counts.Total += row.cnt;
  }
  return counts;
}

async function getStageAggregation(query) {
  const { whereSql, params } = buildTicketFilters(query);
  const res = await pool.query(
    `SELECT s.stage_name AS stage_name,
            ${DISPLAY_STATUS_SQL} AS display_status,
            COUNT(*)::int AS cnt
     ${TICKET_FROM_SQL}
     ${whereSql}
     GROUP BY s.stage_name, 2`,
    params
  );

  const byStageName = new Map();
  for (const row of res.rows) {
    if (!row.stage_name) continue;
    if (!byStageName.has(row.stage_name)) {
      byStageName.set(row.stage_name, { total: 0, done: 0, pending: 0 });
    }
    const bucket = byStageName.get(row.stage_name);
    bucket.total += row.cnt;
    if (row.display_status === 'Done') bucket.done += row.cnt;
    else bucket.pending += row.cnt;
  }

  return REPORT_STAGES.map((def) => {
    let total = 0;
    let done = 0;
    let pending = 0;
    for (const name of def.names) {
      const b = byStageName.get(name);
      if (b) {
        total += b.total;
        done += b.done;
        pending += b.pending;
      }
    }
    return { key: def.key, label: def.label, total, done, pending };
  });
}

async function getTechnicianAggregation(query) {
  const { whereSql, params } = buildTicketFilters(query);
  const res = await pool.query(
    `SELECT COALESCE(u.name, 'Unassigned') AS tech_name,
            ${DISPLAY_STATUS_SQL} AS display_status,
            COUNT(*)::int AS cnt
     ${TICKET_FROM_SQL}
     ${whereSql}
     GROUP BY 1, 2
     ORDER BY 1`,
    params
  );

  const byTech = new Map();
  for (const row of res.rows) {
    if (!byTech.has(row.tech_name)) {
      byTech.set(row.tech_name, { name: row.tech_name, total: 0, inProgress: 0, done: 0, pending: 0 });
    }
    const t = byTech.get(row.tech_name);
    t.total += row.cnt;
    if (row.display_status === 'In Progress') t.inProgress += row.cnt;
    else if (row.display_status === 'Done') t.done += row.cnt;
    else if (row.display_status === 'Pending') t.pending += row.cnt;
  }

  return [...byTech.values()].sort((a, b) => b.total - a.total);
}

async function getConfigurationAggregation(query) {
  const { whereSql, params } = buildTicketFilters(query);
  const res = await pool.query(
    `SELECT t.processor
     ${TICKET_FROM_SQL}
     ${whereSql}`,
    params
  );
  const counts = Object.fromEntries(PROCESSOR_BUCKETS_SHORT.map((b) => [b, 0]));
  for (const row of res.rows) {
    const bucket = bucketProcessorShort(row.processor);
    counts[bucket] = (counts[bucket] || 0) + 1;
  }
  return PROCESSOR_BUCKETS_SHORT.map((label) => ({ label, count: counts[label] || 0 }));
}

async function getTicketRows(query) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit || query.pageSize, 10) || 8, 1), 5000);
  const offset = (page - 1) * limit;
  const { whereSql, params, idx } = buildTicketFilters(query);

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total ${TICKET_FROM_SQL} ${whereSql}`,
    params
  );
  const total = countRes.rows[0]?.total || 0;

  const listRes = await pool.query(
    `SELECT t.ticket_id,
            COALESCE(
              NULLIF(TRIM(t.ttspl_id), ''),
              (regexp_match(t.machine_number, 'TTSPL[0-9]+', 'i'))[1],
              NULLIF(TRIM(t.machine_number), '')
            ) AS ttspl,
            COALESCE(NULLIF(TRIM(t.serial_number), ''), vsn.serial_number) AS serial_number,
            t.brand, t.model, t.processor,
            COALESCE(NULLIF(TRIM(vsn.extra->>'generation'), ''), '') AS generation,
            t.ram, t.storage AS ssd,
            s.stage_name AS current_stage,
            u.name AS assigned_technician,
            tm.team_name AS team,
            ${DISPLAY_STATUS_SQL} AS display_status,
            t.created_at
     ${TICKET_FROM_SQL}
     ${whereSql}
     ORDER BY t.updated_at DESC NULLS LAST, t.ticket_id DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset]
  );

  const rows = listRes.rows.map((row) => {
    const def = REPORT_STAGES.find((s) => s.names.includes(row.current_stage));
    return mapTicketRow({ ...row, stage_key: def?.key || '' });
  });

  return {
    rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

async function getLaptopReport(query = {}) {
  const {
    getStagePerformanceSummary,
    getTechnicianStageMatrix,
    getQcFailedSummaryCount,
  } = require('./laptopReportStagePerformanceService');
  const period = resolvePeriodRange(query);
  const [summary, stages, technicians, configurations, filters, stagePerformance, technicianStageMatrix] = await Promise.all([
    getSummaryCounts(query),
    getStageAggregation(query),
    getTechnicianAggregation(query),
    getConfigurationAggregation(query),
    getFilterOptions(),
    getStagePerformanceSummary(query),
    getTechnicianStageMatrix(query),
  ]);

  summary['QC Failed'] = await getQcFailedSummaryCount(query);

  return {
    success: true,
    period,
    summary,
    stages,
    technicians,
    configurations,
    filters,
    stagePerformance,
    technicianStageMatrix,
  };
}

module.exports = {
  REPORT_STAGES,
  PROCESSOR_BUCKETS_SHORT,
  resolvePeriodRange,
  bucketProcessorShort,
  getLaptopReport,
  getTicketRows,
  getStagePerformanceTickets: (...args) => require('./laptopReportStagePerformanceService').getStagePerformanceTickets(...args),
};
