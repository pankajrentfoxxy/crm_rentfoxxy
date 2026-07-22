const pool = require('../config/db');
const { resolvePeriodRange } = require('./laptopReportService');

const STAGE_PERFORMANCE_STAGES = [
  { key: 'diagnosis', label: 'Diagnosis', name: 'Diagnosis', qc: false },
  { key: 'assembly', label: 'Assembly & Software', name: 'Assembly & Software', qc: false },
  { key: 'testing', label: 'Final Testing', name: 'Final Testing', qc: false },
  { key: 'chip', label: 'Chip Level Repair', name: 'Chip Level Repair', qc: false },
  { key: 'paint', label: 'Body & Paint', name: 'Body & Paint', qc: false },
  { key: 'qc1', label: 'QC1', name: 'QC1', qc: true },
  { key: 'qc2', label: 'QC2', name: 'QC2', qc: true },
  { key: 'dispatchqc', label: 'Dispatch QC', name: 'Dispatch QC', qc: true },
];

const STAGE_NAME_SET = new Set(STAGE_PERFORMANCE_STAGES.map((s) => s.name));

const FAIL_ACTIONS = {
  Diagnosis: new Set(['Diagnosis Failed']),
  QC1: new Set(['QC1 Failed']),
  QC2: new Set(['QC2 Failed']),
  'Dispatch QC': new Set(['Dispatch QC Failed']),
};

function appendHistoryDateFilter(conditions, params, idx, query, alias = 'h') {
  const { from, to, period } = resolvePeriodRange(query);
  if (period === 'all' || !from || !to) return idx;
  conditions.push(`${alias}.created_at >= $${idx}::date`);
  params.push(from);
  idx += 1;
  conditions.push(`${alias}.created_at < ($${idx}::date + interval '1 day')`);
  params.push(to);
  return idx + 1;
}

function isStageEnter(row, stageName) {
  if (row.current_stage !== stageName) return false;
  if (!row.previous_stage || row.previous_stage !== stageName) return true;
  if (String(row.action || '').includes(`${stageName} Started`)) return true;
  return false;
}

function isStageComplete(row, stageName) {
  if (row.previous_stage !== stageName) return false;
  const action = String(row.action || '');
  if (FAIL_ACTIONS[stageName]?.has(action)) return false;
  if (stageName === 'Diagnosis' && ['Assembly & Software', 'Chip Level Repair', 'Body & Paint', 'Procurement'].includes(row.current_stage)) {
    return true;
  }
  if (stageName === 'Assembly & Software' && row.current_stage === 'Final Testing') return true;
  if (stageName === 'Final Testing' && row.current_stage === 'QC1') return true;
  if (stageName === 'Chip Level Repair' && ['Diagnosis', 'Assembly & Software', 'Final Testing'].includes(row.current_stage)) {
    return true;
  }
  if (stageName === 'Body & Paint' && ['Diagnosis', 'Assembly & Software', 'Final Testing', 'QC1'].includes(row.current_stage)) {
    return true;
  }
  if (stageName === 'QC1' && ['QC2', 'Dispatch QC'].includes(row.current_stage)) return true;
  if ((stageName === 'QC2' || stageName === 'Dispatch QC') && row.current_stage === 'Inventory') return true;
  if (action === 'Diagnosis Completed' || action === 'Chip Level Repair Completed' || action === 'QC1 Passed' || action === 'QC2 Passed' || action === 'Dispatch QC Passed') {
    return row.previous_stage === stageName;
  }
  return false;
}

function isStageFail(row, stageName) {
  const action = String(row.action || '');
  if (FAIL_ACTIONS[stageName]?.has(action)) return true;
  if (stageName === 'QC1' && row.previous_stage === 'QC1' && row.current_stage === 'Assembly & Software') return true;
  if (stageName === 'QC2' && row.previous_stage === 'QC2' && row.current_stage === 'QC1') return true;
  return false;
}

async function fetchHistoryBundle(query) {
  const hConds = ['1=1'];
  const hParams = [];
  let idx = 1;
  idx = appendHistoryDateFilter(hConds, hParams, idx, query, 'h');

  const historyRes = await pool.query(
    `SELECT h.*
       FROM production_ticket_history h
      WHERE ${hConds.join(' AND ')}
      ORDER BY h.ticket_id, h.created_at ASC, h.id ASC`,
    hParams
  );

  const aConds = ['1=1'];
  const aParams = [];
  let aIdx = 1;
  const { from, to, period } = resolvePeriodRange(query);
  if (period !== 'all' && from && to) {
    aConds.push(`a.assigned_at >= $${aIdx}::date`);
    aParams.push(from);
    aIdx += 1;
    aConds.push(`a.assigned_at < ($${aIdx}::date + interval '1 day')`);
    aParams.push(to);
  }

  const assignRes = await pool.query(
    `SELECT a.*
       FROM production_assignment_history a
      WHERE ${aConds.join(' AND ')}
      ORDER BY a.ticket_id, a.assigned_at ASC, a.id ASC`,
    aParams
  );

  return { history: historyRes.rows, assignments: assignRes.rows };
}

function collectFailEvents(history, stageNames) {
  const names = Array.isArray(stageNames) ? stageNames : [stageNames];
  const events = [];
  for (const row of history) {
    for (const sn of names) {
      if (!isStageFail(row, sn)) continue;
      events.push({
        eventKey: `fail-${row.id}`,
        historyId: row.id,
        ticket_id: row.ticket_id,
        stageName: sn,
        failedAt: row.created_at,
        completedAt: row.created_at,
        stageStatus: 'failed',
        technicianId: row.current_technician_id,
        technicianName: row.current_technician,
        assignedAt: null,
      });
    }
  }
  return events;
}

function enrichFailEventsWithAssignedAt(events, allHistory, assignments) {
  for (const ep of events) {
    const failTs = new Date(ep.failedAt).getTime();
    let assignedAt = null;
    for (const row of allHistory) {
      if (row.ticket_id !== ep.ticket_id) continue;
      if (new Date(row.created_at).getTime() > failTs) continue;
      if (isStageEnter(row, ep.stageName)) {
        assignedAt = row.created_at;
        ep.technicianId = ep.technicianId || row.current_technician_id;
        ep.technicianName = ep.technicianName || row.current_technician;
      }
    }
    for (const a of assignments) {
      if (a.ticket_id !== ep.ticket_id || a.stage_name !== ep.stageName) continue;
      if (new Date(a.assigned_at).getTime() <= failTs) {
        if (!assignedAt || new Date(a.assigned_at) > new Date(assignedAt)) {
          assignedAt = a.assigned_at;
          ep.technicianId = ep.technicianId || a.technician_id;
          ep.technicianName = ep.technicianName || a.technician_name;
        }
      }
    }
    ep.assignedAt = assignedAt;
  }
  return events;
}

function buildTicketStageMetrics(history, assignments) {
  const byTicket = new Map();

  for (const row of history) {
    if (!byTicket.has(row.ticket_id)) {
      byTicket.set(row.ticket_id, { enters: {}, exits: {}, fails: {} });
    }
    const t = byTicket.get(row.ticket_id);
    for (const stage of STAGE_PERFORMANCE_STAGES) {
      const sn = stage.name;
      if (!t.enters[sn]) t.enters[sn] = 0;
      if (!t.exits[sn]) t.exits[sn] = 0;
      if (!t.fails[sn]) t.fails[sn] = 0;
      if (isStageEnter(row, sn)) t.enters[sn] += 1;
      if (isStageComplete(row, sn)) t.exits[sn] += 1;
      if (isStageFail(row, sn)) t.fails[sn] += 1;
    }
  }

  for (const row of assignments) {
    if (!row.stage_name || !STAGE_NAME_SET.has(row.stage_name)) continue;
    if (!byTicket.has(row.ticket_id)) {
      byTicket.set(row.ticket_id, { enters: {}, exits: {}, fails: {} });
    }
    const t = byTicket.get(row.ticket_id);
    if (!t.enters[row.stage_name]) t.enters[row.stage_name] = 0;
    t.enters[row.stage_name] += 1;
  }

  return byTicket;
}

async function getPendingCounts(query) {
  const conditions = [`t.status NOT IN ('cancelled')`, `s.stage_name = ANY($1::text[])`];
  const params = [STAGE_PERFORMANCE_STAGES.map((s) => s.name)];
  let idx = 2;

  const { from, to, period } = resolvePeriodRange(query);
  if (period !== 'all' && from && to) {
    conditions.push(`t.updated_at >= $${idx}::date`);
    params.push(from);
    idx += 1;
    conditions.push(`t.updated_at < ($${idx}::date + interval '1 day')`);
    params.push(to);
  }

  const res = await pool.query(
    `SELECT s.stage_name, COUNT(*)::int AS cnt
       FROM tickets t
       JOIN stages s ON s.stage_id = t.current_stage_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY s.stage_name`,
    params
  );
  const map = Object.fromEntries(STAGE_PERFORMANCE_STAGES.map((s) => [s.name, 0]));
  for (const row of res.rows) map[row.stage_name] = row.cnt;
  return map;
}

async function fetchPendingTicketIds(stageName, query) {
  const conditions = [
    `t.status NOT IN ('cancelled')`,
    `s.stage_name = $1`,
  ];
  const params = [stageName];
  let idx = 2;

  const { from, to, period } = resolvePeriodRange(query);
  if (period !== 'all' && from && to) {
    conditions.push(`t.updated_at >= $${idx}::date`);
    params.push(from);
    idx += 1;
    conditions.push(`t.updated_at < ($${idx}::date + interval '1 day')`);
    params.push(to);
  }

  const res = await pool.query(
    `SELECT t.ticket_id
       FROM tickets t
       JOIN stages s ON s.stage_id = t.current_stage_id
      WHERE ${conditions.join(' AND ')}`,
    params
  );
  return res.rows.map((r) => r.ticket_id);
}

function collectTicketIdsForBucket(bucket, stageName, filteredHistory, assignments) {
  const ticketIds = new Set();

  if (bucket === 'assigned') {
    for (const row of filteredHistory) {
      if (isStageEnter(row, stageName)) ticketIds.add(row.ticket_id);
    }
    for (const a of assignments) {
      if (a.stage_name === stageName) ticketIds.add(a.ticket_id);
    }
    return ticketIds;
  }

  if (bucket === 'completed' || bucket === 'passed') {
    for (const row of filteredHistory) {
      if (isStageComplete(row, stageName)) ticketIds.add(row.ticket_id);
    }
    return ticketIds;
  }

  if (bucket === 'reworked') {
    const enterCounts = new Map();
    for (const row of filteredHistory) {
      if (!isStageEnter(row, stageName)) continue;
      enterCounts.set(row.ticket_id, (enterCounts.get(row.ticket_id) || 0) + 1);
    }
    for (const [ticketId, count] of enterCounts) {
      if (count > 1) ticketIds.add(ticketId);
    }
    return ticketIds;
  }

  return ticketIds;
}

function buildStageEpisodes(ticketIds, stageName, bucket, filteredHistory, allHistory, assignments) {
  const episodes = new Map();
  const stageDef = STAGE_PERFORMANCE_STAGES.find((s) => s.name === stageName);

  const ensureEp = (ticketId) => {
    if (!episodes.has(ticketId)) {
      episodes.set(ticketId, {
        assignedAt: null,
        completedAt: null,
        failedAt: null,
        stageStatus: bucket === 'pending' ? 'pending' : 'assigned',
        technicianId: null,
        technicianName: null,
      });
    }
    return episodes.get(ticketId);
  };

  for (const ticketId of ticketIds) ensureEp(ticketId);

  const historyForMeta = bucket === 'pending' ? allHistory : filteredHistory;
  for (const row of historyForMeta) {
    if (!ticketIds.has(row.ticket_id)) continue;
    if (isStageEnter(row, stageName)) {
      const ep = ensureEp(row.ticket_id);
      ep.assignedAt = row.created_at;
      ep.stageStatus = bucket === 'pending' ? 'pending' : ep.stageStatus;
      ep.technicianId = row.current_technician_id || ep.technicianId;
      ep.technicianName = row.current_technician || ep.technicianName;
    }
    if ((bucket === 'completed' || bucket === 'passed') && isStageComplete(row, stageName)) {
      const ep = ensureEp(row.ticket_id);
      ep.completedAt = row.created_at;
      ep.stageStatus = stageDef?.qc ? 'passed' : 'completed';
      ep.technicianId = row.current_technician_id || ep.technicianId;
      ep.technicianName = row.current_technician || ep.technicianName;
    }
  }

  for (const a of assignments) {
    if (!ticketIds.has(a.ticket_id) || a.stage_name !== stageName) continue;
    const ep = ensureEp(a.ticket_id);
    if (!ep.assignedAt || new Date(a.assigned_at) > new Date(ep.assignedAt)) {
      if (bucket !== 'completed' && bucket !== 'passed') {
        ep.assignedAt = a.assigned_at;
      }
      ep.technicianId = a.technician_id || ep.technicianId;
      ep.technicianName = a.technician_name || ep.technicianName;
    }
  }

  if (bucket === 'completed' || bucket === 'passed') {
    for (const ticketId of ticketIds) {
      const ep = ensureEp(ticketId);
      if (!ep.assignedAt) {
        for (const row of allHistory) {
          if (row.ticket_id !== ticketId) continue;
          if (!isStageEnter(row, stageName)) continue;
          if (ep.completedAt && new Date(row.created_at).getTime() > new Date(ep.completedAt).getTime()) continue;
          ep.assignedAt = row.created_at;
          ep.technicianId = ep.technicianId || row.current_technician_id;
          ep.technicianName = ep.technicianName || row.current_technician;
        }
      }
    }
  }

  return episodes;
}

async function getStagePerformanceSummary(query = {}) {
  const { history, assignments } = await fetchHistoryBundle(query);
  const ticketMetrics = buildTicketStageMetrics(history, assignments);
  const pendingMap = await getPendingCounts(query);

  return STAGE_PERFORMANCE_STAGES.map((stage) => {
    const sn = stage.name;
    let assigned = 0;
    let completed = 0;
    let failed = 0;
    let reworked = 0;

    for (const metrics of ticketMetrics.values()) {
      const enters = metrics.enters[sn] || 0;
      const exits = metrics.exits[sn] || 0;
      const fails = metrics.fails[sn] || 0;
      if (enters > 0) assigned += 1;
      if (exits > 0) completed += 1;
      failed += fails;
      if (enters > 1) reworked += 1;
    }

    const pending = pendingMap[sn] || 0;
    const result = {
      key: stage.key,
      label: stage.label,
      stage: sn,
      assigned,
      pending,
      failed,
      reworked,
    };
    if (stage.qc) {
      result.passed = completed;
    } else {
      result.completed = completed;
    }
    return result;
  });
}

function creditTechnicianOnEvent(assignments, ticketId, stageName, eventTime) {
  const ts = eventTime ? new Date(eventTime).getTime() : 0;
  const matches = assignments.filter((a) => (
    a.ticket_id === ticketId
    && a.stage_name === stageName
    && a.technician_id
    && new Date(a.assigned_at).getTime() <= ts
    && (!a.unassigned_at || new Date(a.unassigned_at).getTime() >= ts)
  ));
  if (matches.length) return matches[matches.length - 1];
  return null;
}

async function getTechnicianStageMatrix(query = {}) {
  const { history, assignments } = await fetchHistoryBundle(query);
  const matrix = new Map();

  const ensureTech = (techId, techName) => {
    if (!matrix.has(techId)) {
      matrix.set(techId, {
        technician_id: techId,
        name: techName || `User #${techId}`,
        stages: Object.fromEntries(STAGE_PERFORMANCE_STAGES.map((s) => [s.key, { assigned: 0, completed: 0 }])),
      });
    }
    return matrix.get(techId);
  };

  for (const a of assignments) {
    if (!a.technician_id || !a.stage_name) continue;
    const stageDef = STAGE_PERFORMANCE_STAGES.find((s) => s.name === a.stage_name);
    if (!stageDef) continue;
    const row = ensureTech(a.technician_id, a.technician_name);
    row.stages[stageDef.key].assigned += 1;
  }

  for (const h of history) {
    for (const stage of STAGE_PERFORMANCE_STAGES) {
      const sn = stage.name;
      if (!isStageComplete(h, sn)) continue;
      const match = creditTechnicianOnEvent(assignments, h.ticket_id, sn, h.created_at);
      const techId = h.current_technician_id || match?.technician_id;
      const techName = h.current_technician || match?.technician_name;
      if (!techId) continue;
      const row = ensureTech(techId, techName);
      row.stages[stage.key].completed += 1;
    }
  }

  return [...matrix.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function formatDuration(ms) {
  if (!ms || ms < 0 || !Number.isFinite(ms)) return '—';
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${sec}s`;
}

function configSummary(row) {
  const parts = [row.processor, row.generation, row.ram, row.ssd].filter((p) => p && p !== '—');
  return parts.length ? parts.join(' · ') : '—';
}

async function resolveStagePerformanceTicketIds(query) {
  const stageName = query.stage_perf_stage || query.stage_performance_stage;
  const bucket = String(query.stage_perf_bucket || query.stage_performance_bucket || 'assigned').toLowerCase();
  if (!stageName) {
    return { ticketIds: [], stageEpisodes: new Map(), stageName: null, bucket, failEvents: null };
  }

  const { history: filteredHistory, assignments } = await fetchHistoryBundle(query);
  const allHistory = await loadFullProductionHistory();
  const techFilter = query.stage_perf_technician || query.popup_technician;
  const techIdFilter = query.stage_perf_technician_id ? Number(query.stage_perf_technician_id) : null;

  if (bucket === 'failed') {
    let failEvents = collectFailEvents(filteredHistory, stageName);
    failEvents = enrichFailEventsWithAssignedAt(failEvents, allHistory, assignments);
    if (techFilter || techIdFilter) {
      failEvents = failEvents.filter((ep) => {
        if (techIdFilter && ep.technicianId === techIdFilter) return true;
        if (techFilter && ep.technicianName === techFilter) return true;
        return false;
      });
    }
    return {
      ticketIds: [...new Set(failEvents.map((e) => e.ticket_id))],
      stageEpisodes: new Map(),
      stageName,
      bucket,
      failEvents,
    };
  }

  let ticketIdList = [];
  if (bucket === 'pending') {
    ticketIdList = await fetchPendingTicketIds(stageName, query);
  } else {
    ticketIdList = [...collectTicketIdsForBucket(bucket, stageName, filteredHistory, assignments)];
  }

  const stageEpisodes = buildStageEpisodes(
    new Set(ticketIdList),
    stageName,
    bucket,
    filteredHistory,
    allHistory,
    assignments
  );

  let ids = [...ticketIdList];
  if (techFilter || techIdFilter) {
    ids = ids.filter((id) => {
      const ep = stageEpisodes.get(id);
      if (techIdFilter && ep?.technicianId === techIdFilter) return true;
      if (techFilter && ep?.technicianName === techFilter) return true;
      return false;
    });
  }

  return { ticketIds: ids, stageEpisodes, stageName, bucket, failEvents: null };
}

const QC_STAGE_NAMES = ['QC1', 'QC2', 'Dispatch QC'];

async function loadFullProductionHistory() {
  const fullHistoryRes = await pool.query(
    `SELECT h.* FROM production_ticket_history h
      JOIN tickets t ON t.ticket_id = h.ticket_id
     WHERE t.status NOT IN ('cancelled')
     ORDER BY h.ticket_id, h.created_at ASC, h.id ASC`
  );
  return fullHistoryRes.rows;
}

async function getQcFailedSummaryCount(query = {}) {
  const { history: filteredHistory } = await fetchHistoryBundle(query);
  return collectFailEvents(filteredHistory, QC_STAGE_NAMES).length;
}

function mapEventToRow(ep, row, stageNameFallback = null) {
  const stageName = ep.stageName || stageNameFallback || row.current_stage;
  const assignedAt = ep.assignedAt || null;
  const completedAt = ep.completedAt || ep.failedAt || null;
  const durationMs = assignedAt && completedAt
    ? new Date(completedAt).getTime() - new Date(assignedAt).getTime()
    : null;
  return {
    eventKey: ep.eventKey || `TKT-${row.ticket_id}`,
    ticketId: `TKT-${row.ticket_id}`,
    ticket_id: row.ticket_id,
    ttspl: row.ttspl || '—',
    serial: row.serial_number || '—',
    configuration: configSummary(row),
    brand: row.brand || '—',
    model: row.model || '—',
    processor: row.processor || '—',
    generation: row.generation || '—',
    ram: row.ram || '—',
    ssd: row.ssd || '—',
    stage: stageName || '—',
    currentStage: row.current_stage || '—',
    stageStatus: ep.stageStatus || 'failed',
    tech: ep.technicianName || row.assigned_technician || 'Unassigned',
    team: row.team || '—',
    assignedAt: assignedAt ? new Date(assignedAt).toISOString() : null,
    completedAt: completedAt ? new Date(completedAt).toISOString() : null,
    workDuration: formatDuration(durationMs),
    status: row.ticket_status || '—',
  };
}

const TICKET_SELECT_SQL = `
  SELECT t.ticket_id,
         COALESCE(NULLIF(TRIM(t.ttspl_id), ''), NULLIF(TRIM(t.machine_number), '')) AS ttspl,
         COALESCE(NULLIF(TRIM(t.serial_number), ''), vsn.serial_number) AS serial_number,
         t.brand, t.model, t.processor,
         COALESCE(NULLIF(TRIM(vsn.extra->>'generation'), ''), '') AS generation,
         t.ram, t.storage AS ssd,
         s.stage_name AS current_stage,
         u.name AS assigned_technician,
         tm.team_name AS team,
         t.status AS ticket_status
    FROM tickets t
    LEFT JOIN stages s ON s.stage_id = t.current_stage_id
    LEFT JOIN teams tm ON tm.team_id = t.assigned_team_id
    LEFT JOIN users u ON u.user_id = t.assigned_user_id
    LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = t.vendor_serial_id AND vsn.deleted_at IS NULL
`;

async function fetchTicketRowsForEvents(events, query, stageNameFallback = null) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit || query.pageSize, 10) || 8, 1), 5000);
  const offset = (page - 1) * limit;
  const searchRaw = query.search != null ? String(query.search).trim().toLowerCase() : '';

  if (!events.length) {
    return { rows: [], pagination: { page, limit, total: 0, totalPages: 1 } };
  }

  const ticketIds = [...new Set(events.map((e) => e.ticket_id))];
  const listRes = await pool.query(
    `${TICKET_SELECT_SQL} WHERE t.ticket_id = ANY($1::int[])`,
    [ticketIds]
  );
  const ticketMap = new Map(listRes.rows.map((r) => [r.ticket_id, r]));

  let matched = events
    .slice()
    .sort((a, b) => new Date(b.failedAt).getTime() - new Date(a.failedAt).getTime())
    .map((ep) => {
      const row = ticketMap.get(ep.ticket_id);
      if (!row) return null;
      if (searchRaw) {
        const hay = [
          row.ticket_id,
          row.ttspl,
          row.serial_number,
          row.model,
        ].map((v) => String(v || '').toLowerCase()).join(' ');
        if (!hay.includes(searchRaw)) return null;
      }
      return { ep, row };
    })
    .filter(Boolean);

  const total = matched.length;
  const pageSlice = matched.slice(offset, offset + limit);
  const rows = pageSlice.map(({ ep, row }) => mapEventToRow(ep, row, stageNameFallback));

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

async function fetchTicketRowsByIds(ticketIds, query, stageEpisodes, stageNameFallback = null) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit || query.pageSize, 10) || 8, 1), 5000);
  const offset = (page - 1) * limit;

  if (!ticketIds.length) {
    return { rows: [], pagination: { page, limit, total: 0, totalPages: 1 } };
  }

  const searchRaw = query.search != null ? String(query.search).trim() : '';
  const params = [ticketIds];
  let idx = 2;
  let searchSql = '';
  if (searchRaw) {
    searchSql = `AND (
      CAST(t.ticket_id AS TEXT) ILIKE $${idx}
      OR COALESCE(t.ttspl_id, '') ILIKE $${idx}
      OR COALESCE(t.serial_number, '') ILIKE $${idx}
      OR COALESCE(t.model, '') ILIKE $${idx}
    )`;
    params.push(`%${searchRaw}%`);
    idx += 1;
  }

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total
       FROM tickets t
      WHERE t.ticket_id = ANY($1::int[]) ${searchSql}`,
    params
  );
  const total = countRes.rows[0]?.total || 0;

  const listRes = await pool.query(
    `${TICKET_SELECT_SQL}
      WHERE t.ticket_id = ANY($1::int[]) ${searchSql}
      ORDER BY t.updated_at DESC NULLS LAST, t.ticket_id DESC
      LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset]
  );

  const rows = listRes.rows.map((row) => {
    const ep = stageEpisodes.get(row.ticket_id) || {};
    return mapEventToRow(
      {
        ...ep,
        eventKey: `TKT-${row.ticket_id}`,
        stageName: ep.stageName || stageNameFallback || row.current_stage,
      },
      row,
      stageNameFallback
    );
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

async function getQcFailedTickets(query = {}) {
  const { history: filteredHistory, assignments } = await fetchHistoryBundle(query);
  const allHistory = await loadFullProductionHistory();
  let events = collectFailEvents(filteredHistory, QC_STAGE_NAMES);
  events = enrichFailEventsWithAssignedAt(events, allHistory, assignments);
  return fetchTicketRowsForEvents(events, query);
}

async function getStagePerformanceTickets(query = {}) {
  const resolved = await resolveStagePerformanceTicketIds(query);
  if (resolved.bucket === 'failed' && resolved.failEvents?.length) {
    return fetchTicketRowsForEvents(resolved.failEvents, query, resolved.stageName);
  }
  if (resolved.bucket === 'failed') {
    return fetchTicketRowsForEvents([], query, resolved.stageName);
  }
  return fetchTicketRowsByIds(resolved.ticketIds, query, resolved.stageEpisodes, resolved.stageName);
}

module.exports = {
  STAGE_PERFORMANCE_STAGES,
  getStagePerformanceSummary,
  getTechnicianStageMatrix,
  getStagePerformanceTickets,
  getQcFailedSummaryCount,
  getQcFailedTickets,
};
