const pool = require('../config/db');
const { getDisplayTeams, getTeamIdsForFilter } = require('../utils/teamUtils');
const { getLaptopReport, getTicketRows, getStagePerformanceTickets } = require('../services/laptopReportService');
const { getSalesOrderReport, getSalesOrderReportDrilldown } = require('../services/salesOrderReportService');

function formatDuration(seconds) {
    if (seconds == null || !Number.isFinite(seconds)) return '—';
    if (seconds < 1) return '<1s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function resolveDateRange(query) {
    const allTime = query.all_time === '1' || query.all_time === 'true';
    if (allTime) {
        return { allTime: true, from: null, to: null };
    }
    let from = query.from;
    let to = query.to;
    if (!from || !to) {
        const end = new Date();
        const start = new Date();
        start.setUTCDate(start.getUTCDate() - 30);
        from = from || start.toISOString().slice(0, 10);
        to = to || end.toISOString().slice(0, 10);
    }
    return { allTime: false, from, to };
}

/**
 * Date window for the main segment list.
 * - Completed segments: filter by segment end (end_time).
 * - Active / all other cases: filter by assigned_at (start_time).
 */
function appendDateRangeConditions(conditions, params, idx, query, segmentStatus) {
    const { allTime, from, to } = resolveDateRange(query);
    if (allTime) {
        return { idx };
    }

    if (segmentStatus === 'completed') {
        conditions.push(`wl.end_time >= $${idx}::date`);
        params.push(from);
        idx += 1;
        conditions.push(`wl.end_time < ($${idx}::date + interval '1 day')`);
        params.push(to);
        idx += 1;
    } else {
        conditions.push(`wl.start_time >= $${idx}::date`);
        params.push(from);
        idx += 1;
        conditions.push(`wl.start_time < ($${idx}::date + interval '1 day')`);
        params.push(to);
        idx += 1;
    }
    return { idx };
}

const PRODUCTIVITY_STAGE_NAMES = [
    'QC1', 'QC2', 'Diagnosis', 'Assembly & Software',
    'Chip Level Repair', 'Body & Paint', 'Final Testing'
];

const REPORT_STAGE_AVERAGE_EXCLUDE = ['Floor Manager', 'Inventory', 'Dispatch QC'];

function resolveSegmentStatus(query) {
    if (query.segment_status === 'active') return 'active';
    if (query.segment_status === 'completed') return 'completed';
    return '';
}

function appendWorkLogDateClause(conditions, params, idx, query, segmentStatus, wlAlias = 'wl') {
    const { allTime, from, to } = resolveDateRange(query);
    if (allTime) {
        return { idx };
    }
    if (segmentStatus === 'completed') {
        conditions.push(`${wlAlias}.end_time IS NOT NULL`);
        conditions.push(`${wlAlias}.end_time >= $${idx}::date`);
        params.push(from);
        idx += 1;
        conditions.push(`${wlAlias}.end_time < ($${idx}::date + interval '1 day')`);
        params.push(to);
        idx += 1;
    } else {
        conditions.push(`${wlAlias}.start_time >= $${idx}::date`);
        params.push(from);
        idx += 1;
        conditions.push(`${wlAlias}.start_time < ($${idx}::date + interval '1 day')`);
        params.push(to);
        idx += 1;
    }
    return { idx };
}

function appendTicketFiltersForAlias(conditions, params, idx, query, alias = 't') {
    if (query.user_id) {
        const uid = parseInt(query.user_id, 10);
        if (Number.isInteger(uid)) {
            conditions.push(`${alias}.assigned_user_id = $${idx}`);
            params.push(uid);
            idx += 1;
        }
    }

    if (Array.isArray(query.team_ids) && query.team_ids.length) {
        conditions.push(`${alias}.assigned_team_id = ANY($${idx}::int[])`);
        params.push(query.team_ids);
        idx += 1;
    } else if (query.team_id) {
        const tid = parseInt(query.team_id, 10);
        if (Number.isInteger(tid)) {
            conditions.push(`${alias}.assigned_team_id = $${idx}`);
            params.push(tid);
            idx += 1;
        }
    }

    if (query.ticket_status) {
        conditions.push(`${alias}.status = $${idx}`);
        params.push(String(query.ticket_status));
        idx += 1;
    }

    if (query.stage_id) {
        const sid = parseInt(query.stage_id, 10);
        if (Number.isInteger(sid)) {
            conditions.push(`${alias}.current_stage_id = $${idx}`);
            params.push(sid);
            idx += 1;
        }
    }

    const searchRaw = query.search != null ? String(query.search).trim() : '';
    if (searchRaw) {
        const term = `%${searchRaw}%`;
        conditions.push(`(
            CAST(${alias}.ticket_id AS TEXT) ILIKE $${idx}
            OR COALESCE(${alias}.ttspl_id, '') ILIKE $${idx}
            OR COALESCE(${alias}.serial_number, '') ILIKE $${idx}
            OR COALESCE(${alias}.machine_number, '') ILIKE $${idx}
            OR EXISTS (
                SELECT 1 FROM users su
                WHERE su.user_id = ${alias}.assigned_user_id AND su.name ILIKE $${idx}
            )
        )`);
        params.push(term);
        idx += 1;
    }

    return { idx };
}

function appendTicketFilters(conditions, params, idx, query) {
    return appendTicketFiltersForAlias(conditions, params, idx, query, 't');
}

/** Ticket rows included in the report (matches Floor Tickets + filters). */
function buildTicketScopeWhere(query) {
    const conditions = [
        `t.status IN ('in_progress', 'on_hold', 'qc_failed_return_vendor', 'completed', 'failed')`
    ];
    const params = [];
    let idx = 1;
    const segmentStatus = resolveSegmentStatus(query);
    const { allTime, from, to } = resolveDateRange(query);

    if (!allTime) {
        if (segmentStatus === 'completed') {
            conditions.push(`EXISTS (
                SELECT 1 FROM work_logs wl
                WHERE wl.ticket_id = t.ticket_id
                  AND wl.end_time IS NOT NULL
                  AND wl.end_time >= $${idx}::date
                  AND wl.end_time < ($${idx + 1}::date + interval '1 day')
            )`);
        } else {
            conditions.push(`EXISTS (
                SELECT 1 FROM work_logs wl
                WHERE wl.ticket_id = t.ticket_id
                  AND wl.start_time >= $${idx}::date
                  AND wl.start_time < ($${idx + 1}::date + interval '1 day')
            )`);
        }
        params.push(from, to);
        idx += 2;
    }

    if (segmentStatus === 'active') {
        conditions.push(`EXISTS (
            SELECT 1 FROM work_logs wl
            WHERE wl.ticket_id = t.ticket_id AND wl.end_time IS NULL
        )`);
    } else if (segmentStatus === 'completed') {
        conditions.push(`EXISTS (
            SELECT 1 FROM work_logs wl
            WHERE wl.ticket_id = t.ticket_id AND wl.end_time IS NOT NULL
        )`);
    }

    ({ idx } = appendTicketFiltersForAlias(conditions, params, idx, query, 't'));

    const whereSql = conditions.length ? conditions.join(' AND ') : 'TRUE';
    return { whereSql, params, idx, segmentStatus };
}

function buildFilter(query) {
    const conditions = [];
    const params = [];
    let idx = 1;
    const segmentStatus = resolveSegmentStatus(query);

    ({ idx } = appendWorkLogDateClause(conditions, params, idx, query, segmentStatus, 'wl'));
    ({ idx } = appendTicketFiltersForAlias(conditions, params, idx, query, 't'));

    if (segmentStatus === 'active') {
        conditions.push('wl.end_time IS NULL');
    } else if (segmentStatus === 'completed') {
        conditions.push('wl.end_time IS NOT NULL');
    }

    const whereSql = conditions.length ? conditions.join(' AND ') : 'TRUE';
    return { whereSql, params, idx, segmentStatus };
}

/** Users who work tickets: on a team tied to at least one workflow stage. */
const STAGE_TECHNICIANS_SQL = `
  SELECT DISTINCT u.user_id, u.name
  FROM users u
  WHERE COALESCE(u.active, true) = true
    AND u.role IN ('team_member', 'team_lead', 'floor_manager')
    AND (
      EXISTS (
        SELECT 1 FROM stages s WHERE s.team_id IS NOT NULL AND s.team_id = u.team_id
      )
      OR EXISTS (
        SELECT 1 FROM user_teams ut
        INNER JOIN stages s ON s.team_id = ut.team_id
        WHERE ut.user_id = u.user_id
      )
    )
  ORDER BY u.name ASC
`;

const HW_STAGE_FILTER = `(cs.stage_category = 'Hardware & Software' OR cs.stage_name IN ('Diagnosis', 'Assembly & Software', 'Final Testing'))`;
const QC_STAGE_FILTER = `(cs.stage_category = 'QC Team' OR cs.stage_name IN ('QC1', 'QC2'))`;
const HW_WORK_STAGE_FILTER = `(s.stage_category = 'Hardware & Software' OR s.stage_name IN ('Diagnosis', 'Assembly & Software', 'Final Testing'))`;
const QC_WORK_STAGE_FILTER = `(s.stage_category = 'QC Team' OR s.stage_name IN ('QC1', 'QC2'))`;

/** Same filters as the segment table, without the date-range clause (for open-segment counts). */
function buildFilterWithoutDate(query) {
    const conditions = [];
    const params = [];
    let idx = 1;
    const segmentStatus = resolveSegmentStatus(query);

    ({ idx } = appendTicketFiltersForAlias(conditions, params, idx, query, 't'));

    if (segmentStatus === 'active') {
        conditions.push('wl.end_time IS NULL');
    } else if (segmentStatus === 'completed') {
        conditions.push('wl.end_time IS NOT NULL');
    }

    const whereSql = conditions.length ? conditions.join(' AND ') : 'TRUE';
    return { whereSql, params, idx, segmentStatus };
}

function buildTeamMembersSql(teamIds) {
    const ids = (Array.isArray(teamIds) ? teamIds : [])
        .map((id) => parseInt(id, 10))
        .filter(Number.isInteger);
    if (!ids.length) {
        return { sql: STAGE_TECHNICIANS_SQL, params: [] };
    }
    return {
        sql: `
          SELECT DISTINCT u.user_id, u.name
          FROM users u
          WHERE COALESCE(u.active, true) = true
            AND u.role IN ('team_member', 'team_lead', 'floor_manager', 'qc', 'dispatch_qc')
            AND (
              u.team_id = ANY($1::int[])
              OR EXISTS (
                SELECT 1 FROM user_teams ut
                WHERE ut.user_id = u.user_id AND ut.team_id = ANY($1::int[])
              )
            )
          ORDER BY u.name ASC
        `,
        params: [ids],
    };
}

function buildTechniciansSql(teamId, teamIds = null) {
    if (teamIds?.length) {
        return buildTeamMembersSql(teamIds);
    }
    if (!teamId) {
        return { sql: STAGE_TECHNICIANS_SQL, params: [] };
    }
    return buildTeamMembersSql([parseInt(teamId, 10)].filter(Number.isInteger));
}

function diagnosisDateClause(query, startIdx) {
    const { allTime, from, to } = resolveDateRange(query);
    if (allTime) {
        return { clause: `dr.status = 'Completed'`, params: [], nextIdx: startIdx };
    }
    return {
        clause: `dr.status = 'Completed'
            AND dr.diagnosed_at >= $${startIdx}::date
            AND dr.diagnosed_at < ($${startIdx + 1}::date + interval '1 day')`,
        params: [from, to],
        nextIdx: startIdx + 2
    };
}

const HW_MEMBERS_SQL = `
  SELECT DISTINCT u.user_id, u.name
  FROM users u
  WHERE COALESCE(u.active, true) = true
    AND EXISTS (
      SELECT 1 FROM stages s
      WHERE (s.stage_category = 'Hardware & Software'
        OR s.stage_name IN ('Diagnosis', 'Assembly & Software', 'Final Testing'))
        AND s.team_id IS NOT NULL
        AND (s.team_id = u.team_id OR EXISTS (
          SELECT 1 FROM user_teams ut WHERE ut.user_id = u.user_id AND ut.team_id = s.team_id
        ))
    )
  ORDER BY u.name ASC
`;

const QC_MEMBERS_SQL = `
  SELECT DISTINCT u.user_id, u.name
  FROM users u
  WHERE COALESCE(u.active, true) = true
    AND EXISTS (
      SELECT 1 FROM stages s
      WHERE (s.stage_category = 'QC Team' OR s.stage_name IN ('QC1', 'QC2'))
        AND s.team_id IS NOT NULL
        AND (s.team_id = u.team_id OR EXISTS (
          SELECT 1 FROM user_teams ut WHERE ut.user_id = u.user_id AND ut.team_id = s.team_id
        ))
    )
  ORDER BY u.name ASC
`;

function sumMetrics(rows, keys) {
    const totals = {};
    keys.forEach((k) => { totals[k] = 0; });
    rows.forEach((row) => {
        keys.forEach((k) => { totals[k] += row[k] ?? 0; });
    });
    return totals;
}

function mergeCategoryRows(members, workRows, dxRows, metricKeys) {
    const nameMap = Object.fromEntries(members.map((m) => [m.user_id, m.name]));
    const byUser = {};

    workRows.forEach((r) => {
        byUser[r.user_id] = { ...r, name: r.name || nameMap[r.user_id] };
    });
    dxRows.forEach((r) => {
        if (!byUser[r.user_id]) {
            byUser[r.user_id] = { user_id: r.user_id, name: r.name || nameMap[r.user_id] };
        }
        byUser[r.user_id].chip_tickets = r.chip_tickets ?? 0;
        byUser[r.user_id].body_tickets = r.body_tickets ?? 0;
    });

    const membersOut = Object.values(byUser)
        .map((row) => {
            const out = {
                user_id: row.user_id,
                name: row.name || nameMap[row.user_id] || `User #${row.user_id}`,
                total_tickets: row.total_tickets ?? 0,
                active_till_today: row.active_till_today ?? 0,
                completed_segments: row.completed_segments ?? 0,
                chip_tickets: row.chip_tickets ?? 0,
                body_tickets: row.body_tickets ?? 0,
                qc1_segments: row.qc1_segments ?? 0,
                qc2_segments: row.qc2_segments ?? 0,
                parts_used_count: row.parts_used_count ?? 0,
                upgrades_done: row.upgrades_done ?? 0
            };
            return out;
        })
        .filter((row) => metricKeys.some((k) => row[k] > 0))
        .sort((a, b) => a.name.localeCompare(b.name));

    return { members: membersOut, totals: sumMetrics(membersOut, metricKeys) };
}

async function queryCategoryWorkMetrics(query, categoryFilter, workStageFilter) {
    const tableFilter = buildFilter(query);
    const openFilter = buildFilterWithoutDate(query);
    const ticketScope = buildTicketScopeWhere(query);
    const categoryStageFilter = categoryFilter.replace(/\bs\./g, 'cs.');

    const joinFrom = `
      FROM work_logs wl
      INNER JOIN tickets t ON t.ticket_id = wl.ticket_id
      INNER JOIN stages s ON s.stage_id = wl.stage_id
      INNER JOIN users u ON u.user_id = wl.user_id
      LEFT JOIN ticket_parts tp ON tp.ticket_id = wl.ticket_id
        AND tp.added_at >= wl.start_time
        AND tp.added_at <= COALESCE(wl.end_time, NOW())
    `;

    const [assignedRes, tableRes, openRes] = await Promise.all([
        pool.query(
            `SELECT t.assigned_user_id AS user_id, au.name,
              COUNT(DISTINCT t.ticket_id)::int AS total_tickets
             FROM tickets t
             INNER JOIN users au ON au.user_id = t.assigned_user_id
             INNER JOIN stages cs ON cs.stage_id = t.current_stage_id
             WHERE (${ticketScope.whereSql})
               AND t.assigned_user_id IS NOT NULL
               AND ${categoryStageFilter}
             GROUP BY t.assigned_user_id, au.name`,
            ticketScope.params
        ),
        pool.query(
            `SELECT wl.user_id, u.name,
              COUNT(DISTINCT wl.ticket_id)::int AS worked_tickets,
              COUNT(*) FILTER (WHERE wl.end_time IS NOT NULL)::int AS completed_segments,
              COUNT(*) FILTER (WHERE s.stage_name = 'QC1' AND wl.end_time IS NOT NULL)::int AS qc1_segments,
              COUNT(*) FILTER (WHERE s.stage_name = 'QC2' AND wl.end_time IS NOT NULL)::int AS qc2_segments,
              COUNT(DISTINCT tp.id) FILTER (WHERE tp.id IS NOT NULL)::int AS parts_used_count,
              COUNT(DISTINCT tp.id) FILTER (WHERE tp.is_upgrade = true)::int AS upgrades_done
             ${joinFrom}
             WHERE (${tableFilter.whereSql}) AND ${workStageFilter}
             GROUP BY wl.user_id, u.name`,
            tableFilter.params
        ),
        pool.query(
            `SELECT wl.user_id, COUNT(*)::int AS active_till_today
             FROM work_logs wl
             INNER JOIN tickets t ON t.ticket_id = wl.ticket_id
             INNER JOIN stages s ON s.stage_id = wl.stage_id
             WHERE (${openFilter.whereSql}) AND ${workStageFilter} AND wl.end_time IS NULL
             GROUP BY wl.user_id`,
            openFilter.params
        )
    ]);

    const openMap = Object.fromEntries(openRes.rows.map((r) => [r.user_id, r.active_till_today]));
    const workMap = Object.fromEntries(tableRes.rows.map((r) => [r.user_id, r]));
    const assignedMap = Object.fromEntries(assignedRes.rows.map((r) => [r.user_id, r]));

    const userIds = new Set([
        ...assignedRes.rows.map((r) => r.user_id),
        ...tableRes.rows.map((r) => r.user_id),
        ...openRes.rows.map((r) => r.user_id)
    ]);

    return [...userIds].map((userId) => {
        const assigned = assignedMap[userId] || {};
        const work = workMap[userId] || {};
        return {
            user_id: userId,
            name: assigned.name || work.name,
            total_tickets: assigned.total_tickets ?? work.worked_tickets ?? 0,
            active_till_today: openMap[userId] ?? 0,
            completed_segments: work.completed_segments ?? 0,
            qc1_segments: work.qc1_segments ?? 0,
            qc2_segments: work.qc2_segments ?? 0,
            parts_used_count: work.parts_used_count ?? 0,
            upgrades_done: work.upgrades_done ?? 0
        };
    });
}

async function queryDiagnosisRouting(query) {
    const dxDate = diagnosisDateClause(query, 1);
    const conditions = [dxDate.clause];
    const params = [...dxDate.params];
    let idx = dxDate.nextIdx;

    if (query.user_id) {
        const uid = parseInt(query.user_id, 10);
        if (Number.isInteger(uid)) {
            conditions.push(`dr.diagnosed_by = $${idx}`);
            params.push(uid);
            idx += 1;
        }
    }

    const sql = `
      SELECT
        dr.diagnosed_by AS user_id,
        u.name,
        COUNT(DISTINCT dr.ticket_id) FILTER (WHERE dr.next_team = 'Chip Level Repair')::int AS chip_tickets,
        COUNT(DISTINCT dr.ticket_id) FILTER (WHERE dr.next_team = 'Body & Paint')::int AS body_tickets
      FROM diagnosis_results dr
      INNER JOIN users u ON u.user_id = dr.diagnosed_by
      WHERE ${conditions.join(' AND ')}
      GROUP BY dr.diagnosed_by, u.name
    `;

    const res = await pool.query(sql, params);
    return res.rows;
}

function resolveSummaryMode(query) {
    if (query.stage_id) return 'stage';
    if (query.team_id) return 'team';
    if (query.user_id) return 'technician';
    return 'technicians';
}

const TICKET_SCOPE_OVERDUE_SQL = `ts.ticket_status IN ('in_progress', 'on_hold') AND (
  COALESCE(ts.highlighted, FALSE) = TRUE
  OR EXISTS (
    SELECT 1 FROM work_logs wl
    WHERE wl.ticket_id = ts.ticket_id
      AND wl.end_time IS NULL
      AND wl.start_time < NOW() - interval '48 hours'
  )
)`;

function buildWorkLogDateSql(query, params, segmentStatus, wlAlias = 'wl') {
    const clauses = [];
    const { allTime, from, to } = resolveDateRange(query);
    if (allTime) return { sql: '', params };
    let idx = params.length + 1;
    if (segmentStatus === 'completed') {
        clauses.push(`${wlAlias}.end_time IS NOT NULL`);
        clauses.push(`${wlAlias}.end_time >= $${idx}::date`);
        params.push(from);
        idx += 1;
        clauses.push(`${wlAlias}.end_time < ($${idx}::date + interval '1 day')`);
        params.push(to);
    } else {
        clauses.push(`${wlAlias}.start_time >= $${idx}::date`);
        params.push(from);
        idx += 1;
        clauses.push(`${wlAlias}.start_time < ($${idx}::date + interval '1 day')`);
        params.push(to);
    }
    return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params };
}

function mapScopeStatsRow(row) {
    const total = row.total_assigned ?? 0;
    return {
        total_tickets: total,
        total_assigned: total,
        active_tickets: row.active_tickets ?? 0,
        completed_tickets: row.completed_tickets ?? 0,
        pending_tickets: row.pending_tickets ?? 0,
        overdue_tickets: row.overdue_tickets ?? 0,
        returned_tickets: row.returned_tickets ?? 0,
        failed_tickets: row.failed_tickets ?? 0,
        in_progress_tickets: row.in_progress_tickets ?? 0,
        handed_over_tickets: row.handed_over_tickets ?? 0,
        qc1_tickets: row.qc1_tickets ?? 0,
        qc2_tickets: row.qc2_tickets ?? 0,
        chip_repair_tickets: row.chip_repair_tickets ?? 0,
        body_paint_tickets: row.body_paint_tickets ?? 0,
        currently_working: row.currently_working ?? 0,
        average_completion_seconds: row.average_completion_seconds,
        average_completion_human: formatDuration(row.average_completion_seconds),
        average_stage_seconds: row.average_stage_seconds,
        average_stage_human: formatDuration(row.average_stage_seconds),
        total_working_seconds: row.total_working_seconds,
        total_working_human: formatDuration(row.total_working_seconds),
    };
}

async function fetchScopeAggregateStats(query, { stageIdForAvg = null } = {}) {
    const ticketScope = buildTicketScopeWhere(query);
    const segmentStatus = resolveSegmentStatus(query);
    const params = [...ticketScope.params];
    const wlDate = buildWorkLogDateSql(query, params, segmentStatus, 'wl');
    const stageAvgFilter = stageIdForAvg
        ? ` AND wl.stage_id = ${Number(stageIdForAvg)}`
        : '';
    const stageWorkingFilter = stageIdForAvg
        ? ` AND wl.stage_id = ${Number(stageIdForAvg)}`
        : '';

    const sql = `
      WITH ticket_scope AS (
        SELECT
          t.ticket_id,
          t.status AS ticket_status,
          t.current_stage_id,
          t.assigned_user_id,
          t.highlighted,
          t.completed_at AS ticket_completed_at
        FROM tickets t
        WHERE ${ticketScope.whereSql}
      ),
      first_starts AS (
        SELECT ticket_id, MIN(start_time) AS first_start
        FROM work_logs
        GROUP BY ticket_id
      )
      SELECT
        COUNT(*)::int AS total_assigned,
        COUNT(*) FILTER (WHERE ts.ticket_status = 'in_progress')::int AS active_tickets,
        COUNT(*) FILTER (WHERE ts.ticket_status = 'completed')::int AS completed_tickets,
        COUNT(*) FILTER (WHERE ts.ticket_status = 'on_hold')::int AS pending_tickets,
        COUNT(*) FILTER (WHERE ${TICKET_SCOPE_OVERDUE_SQL})::int AS overdue_tickets,
        COUNT(*) FILTER (WHERE ts.ticket_status = 'qc_failed_return_vendor')::int AS returned_tickets,
        COUNT(*) FILTER (WHERE ts.ticket_status = 'failed')::int AS failed_tickets,
        COUNT(*) FILTER (WHERE ts.ticket_status = 'in_progress')::int AS in_progress_tickets,
        COUNT(*) FILTER (WHERE cs.stage_name = 'QC1')::int AS qc1_tickets,
        COUNT(*) FILTER (WHERE cs.stage_name = 'QC2')::int AS qc2_tickets,
        COUNT(*) FILTER (WHERE cs.stage_name = 'Chip Level Repair')::int AS chip_repair_tickets,
        COUNT(*) FILTER (WHERE cs.stage_name = 'Body & Paint')::int AS body_paint_tickets,
        (SELECT COUNT(DISTINCT wl.ticket_id)::int
           FROM work_logs wl
           INNER JOIN ticket_scope ts2 ON ts2.ticket_id = wl.ticket_id
          WHERE wl.end_time IS NOT NULL${wlDate.sql}) AS handed_over_tickets,
        AVG(EXTRACT(EPOCH FROM (ts.ticket_completed_at - fs.first_start))) FILTER (
          WHERE ts.ticket_completed_at IS NOT NULL
        )::float AS average_completion_seconds,
        (SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(wl.end_time, CURRENT_TIMESTAMP) - wl.start_time)))::float
           FROM work_logs wl
           INNER JOIN ticket_scope ts3 ON ts3.ticket_id = wl.ticket_id) AS total_working_seconds,
        (SELECT AVG(EXTRACT(EPOCH FROM (wl.end_time - wl.start_time)))::float
           FROM work_logs wl
           INNER JOIN ticket_scope ts4 ON ts4.ticket_id = wl.ticket_id
          WHERE wl.end_time IS NOT NULL${stageAvgFilter}${wlDate.sql}) AS average_stage_seconds,
        (SELECT COUNT(DISTINCT wl.ticket_id)::int
           FROM work_logs wl
           INNER JOIN ticket_scope ts5 ON ts5.ticket_id = wl.ticket_id
          WHERE wl.end_time IS NULL${stageWorkingFilter}) AS currently_working
      FROM ticket_scope ts
      LEFT JOIN stages cs ON cs.stage_id = ts.current_stage_id
      LEFT JOIN first_starts fs ON fs.ticket_id = ts.ticket_id
    `;

    const { rows } = await pool.query(sql, params);
    return mapScopeStatsRow(rows[0] || {});
}

async function fetchDynamicSummary(query) {
    const mode = resolveSummaryMode(query);

    if (mode === 'technicians') {
        const technicians = await fetchTechnicianSummary(query);
        return {
            mode,
            title: 'Technician summary',
            subtitle: 'Click a row to filter the detailed report below.',
            technicians,
        };
    }

    const stageId = query.stage_id ? parseInt(query.stage_id, 10) : null;
    const teamId = query.team_id ? parseInt(query.team_id, 10) : null;
    const userId = query.user_id ? parseInt(query.user_id, 10) : null;

    let label = 'Summary';
    if (mode === 'technician' && userId) {
        const u = await pool.query('SELECT name FROM users WHERE user_id = $1', [userId]);
        label = u.rows[0]?.name || 'Technician';
    } else if (mode === 'stage' && stageId) {
        const s = await pool.query('SELECT stage_name FROM stages WHERE stage_id = $1', [stageId]);
        label = s.rows[0]?.stage_name || 'Stage';
    } else if (mode === 'team' && teamId) {
        const t = await pool.query('SELECT team_name FROM teams WHERE team_id = $1', [teamId]);
        label = t.rows[0]?.team_name || 'Team';
    }

    if (mode === 'team') {
        const [metrics, technicians] = await Promise.all([
            fetchScopeAggregateStats(query),
            fetchTechnicianSummary(query),
        ]);
        return {
            mode,
            title: `${label} team summary`,
            subtitle: 'Team overview and member workload. Click a member to filter the detailed report.',
            label,
            metrics,
            technicians,
        };
    }

    const metrics = await fetchScopeAggregateStats(query, {
        stageIdForAvg: mode === 'stage' ? stageId : null,
    });

    const titles = {
        technician: `${label} summary`,
        stage: `${label} stage summary`,
    };
    const subtitles = {
        technician: 'Statistics for the selected technician within the current filters.',
        stage: 'Stage metrics for tickets currently in this stage within the current filters.',
    };

    return {
        mode,
        title: titles[mode] || 'Summary',
        subtitle: subtitles[mode] || '',
        label,
        metrics,
    };
}

async function fetchTechnicianSummary(query) {
    const ticketScope = buildTicketScopeWhere(query);
    const techQuery = buildTechniciansSql(query.team_id, query.team_ids);

    const statsSql = `
      WITH ticket_scope AS (
        SELECT
          t.ticket_id,
          t.status AS ticket_status,
          t.current_stage_id,
          t.assigned_user_id,
          t.highlighted,
          t.completed_at AS ticket_completed_at
        FROM tickets t
        WHERE ${ticketScope.whereSql}
      ),
      tech_stats AS (
        SELECT
          ts.assigned_user_id AS user_id,
          COUNT(*)::int AS total_assigned,
          COUNT(*) FILTER (WHERE ts.ticket_status = 'in_progress')::int AS active_tickets,
          COUNT(*) FILTER (WHERE ts.ticket_status = 'completed')::int AS completed_tickets,
          COUNT(*) FILTER (WHERE ts.ticket_status = 'on_hold')::int AS pending_tickets,
          COUNT(*) FILTER (WHERE ts.ticket_status IN ('in_progress', 'on_hold') AND (
            COALESCE(ts.highlighted, FALSE) = TRUE
            OR EXISTS (
              SELECT 1 FROM work_logs wl
              WHERE wl.ticket_id = ts.ticket_id
                AND wl.end_time IS NULL
                AND wl.start_time < NOW() - interval '48 hours'
            )
          ))::int AS overdue_tickets,
          COUNT(*) FILTER (WHERE cs.stage_name = 'QC1')::int AS qc1_tickets,
          COUNT(*) FILTER (WHERE cs.stage_name = 'QC2')::int AS qc2_tickets,
          COUNT(*) FILTER (WHERE cs.stage_name = 'Chip Level Repair')::int AS chip_repair_tickets,
          COUNT(*) FILTER (WHERE cs.stage_name = 'Body & Paint')::int AS body_paint_tickets
        FROM ticket_scope ts
        LEFT JOIN stages cs ON cs.stage_id = ts.current_stage_id
        WHERE ts.assigned_user_id IS NOT NULL
        GROUP BY ts.assigned_user_id
      ),
      tech_work AS (
        SELECT
          ts.assigned_user_id AS user_id,
          AVG(EXTRACT(EPOCH FROM (ts.ticket_completed_at - first_log.first_start))) FILTER (
            WHERE ts.ticket_completed_at IS NOT NULL
          )::float AS average_completion_seconds,
          SUM(EXTRACT(EPOCH FROM (COALESCE(wl.end_time, CURRENT_TIMESTAMP) - wl.start_time)))::float AS total_working_seconds
        FROM ticket_scope ts
        INNER JOIN work_logs wl ON wl.ticket_id = ts.ticket_id
        INNER JOIN (
          SELECT ticket_id, MIN(start_time) AS first_start
          FROM work_logs
          GROUP BY ticket_id
        ) first_log ON first_log.ticket_id = ts.ticket_id
        WHERE ts.assigned_user_id IS NOT NULL
        GROUP BY ts.assigned_user_id
      )
      SELECT
        ts.user_id,
        ts.total_assigned,
        ts.active_tickets,
        ts.completed_tickets,
        ts.pending_tickets,
        ts.overdue_tickets,
        ts.qc1_tickets,
        ts.qc2_tickets,
        ts.chip_repair_tickets,
        ts.body_paint_tickets,
        tw.average_completion_seconds,
        tw.total_working_seconds
      FROM tech_stats ts
      LEFT JOIN tech_work tw ON tw.user_id = ts.user_id
    `;

    const [techRes, statsRes] = await Promise.all([
        pool.query(techQuery.sql, techQuery.params),
        pool.query(statsSql, ticketScope.params),
    ]);

    const statsByUser = Object.fromEntries(statsRes.rows.map((r) => [r.user_id, r]));

    return techRes.rows.map((tech) => {
        const s = statsByUser[tech.user_id] || {};
        return {
            user_id: tech.user_id,
            name: tech.name,
            total_assigned: s.total_assigned ?? 0,
            active_tickets: s.active_tickets ?? 0,
            completed_tickets: s.completed_tickets ?? 0,
            pending_tickets: s.pending_tickets ?? 0,
            overdue_tickets: s.overdue_tickets ?? 0,
            qc1_tickets: s.qc1_tickets ?? 0,
            qc2_tickets: s.qc2_tickets ?? 0,
            chip_repair_tickets: s.chip_repair_tickets ?? 0,
            body_paint_tickets: s.body_paint_tickets ?? 0,
            average_completion_seconds: s.average_completion_seconds,
            average_completion_human: formatDuration(s.average_completion_seconds),
            total_working_seconds: s.total_working_seconds,
            total_working_human: formatDuration(s.total_working_seconds),
        };
    });
}

async function fetchTeamWorkloadDashboard(query) {
    const HW_METRIC_KEYS = ['total_tickets', 'active_till_today', 'completed_segments', 'chip_tickets', 'body_tickets', 'parts_used_count', 'upgrades_done'];
    const QC_METRIC_KEYS = ['total_tickets', 'active_till_today', 'completed_segments', 'qc1_segments', 'qc2_segments', 'parts_used_count', 'upgrades_done'];

    const [hwMembersRes, qcMembersRes, hwWork, qcWork, dxRows] = await Promise.all([
        pool.query(HW_MEMBERS_SQL),
        pool.query(QC_MEMBERS_SQL),
        queryCategoryWorkMetrics(query, HW_STAGE_FILTER, HW_WORK_STAGE_FILTER),
        queryCategoryWorkMetrics(query, QC_STAGE_FILTER, QC_WORK_STAGE_FILTER),
        queryDiagnosisRouting(query)
    ]);

    const hardware_software = mergeCategoryRows(hwMembersRes.rows, hwWork, dxRows, HW_METRIC_KEYS);
    const qc = mergeCategoryRows(qcMembersRes.rows, qcWork, [], QC_METRIC_KEYS);

    const { allTime, from, to } = resolveDateRange(query);
    return {
        date_range: allTime ? null : { from, to },
        uses_table_filters: true,
        hardware_software,
        qc
    };
}

exports.getTechnicianPerformance = async (req, res) => {
    try {
        const reportQuery = { ...req.query };
        if (reportQuery.team_id) {
            reportQuery.team_ids = await getTeamIdsForFilter(reportQuery.team_id);
        }

        const { whereSql, params } = buildFilter(reportQuery);
        const ticketScope = buildTicketScopeWhere(reportQuery);
        const { page, limit, offset } = parsePagination(reportQuery);
        const techQuery = buildTechniciansSql(reportQuery.team_id, reportQuery.team_ids);
        const segmentStatus = resolveSegmentStatus(reportQuery);
        const stageNamesList = PRODUCTIVITY_STAGE_NAMES.map((n) => `'${n.replace(/'/g, "''")}'`).join(', ');

        const ticketScopeCte = `
      WITH ticket_scope AS (
        SELECT
          t.ticket_id,
          t.status AS ticket_status,
          t.machine_number,
          t.serial_number,
          t.ttspl_id,
          t.vendor_serial_id,
          t.current_stage_id,
          t.assigned_user_id,
          t.assigned_team_id,
          t.completed_at AS ticket_completed_at,
          t.highlighted,
          t.created_at
        FROM tickets t
        WHERE ${ticketScope.whereSql}
      )
    `;

        const cte = `
      WITH filtered AS (
        SELECT
          wl.log_id,
          wl.ticket_id,
          wl.user_id AS segment_user_id,
          wl.stage_id,
          wl.start_time,
          wl.end_time,
          t.status AS ticket_status,
          t.machine_number,
          t.serial_number,
          t.ttspl_id,
          t.vendor_serial_id,
          t.current_stage_id,
          t.assigned_user_id,
          t.assigned_team_id,
          t.completed_at AS ticket_completed_at
        FROM work_logs wl
        INNER JOIN tickets t ON t.ticket_id = wl.ticket_id
        WHERE ${whereSql}
      )
    `;

        const wlDateForStageDone = [];
        const stageDoneParams = [...ticketScope.params];
        let stageDoneIdx = stageDoneParams.length + 1;
        if (!resolveDateRange(reportQuery).allTime) {
            const { from, to } = resolveDateRange(reportQuery);
            if (segmentStatus === 'completed') {
                wlDateForStageDone.push(`wl.end_time IS NOT NULL`);
                wlDateForStageDone.push(`wl.end_time >= $${stageDoneIdx}::date`);
                stageDoneParams.push(from);
                stageDoneIdx += 1;
                wlDateForStageDone.push(`wl.end_time < ($${stageDoneIdx}::date + interval '1 day')`);
                stageDoneParams.push(to);
                stageDoneIdx += 1;
            } else {
                wlDateForStageDone.push(`wl.start_time >= $${stageDoneIdx}::date`);
                stageDoneParams.push(from);
                stageDoneIdx += 1;
                wlDateForStageDone.push(`wl.start_time < ($${stageDoneIdx}::date + interval '1 day')`);
                stageDoneParams.push(to);
                stageDoneIdx += 1;
            }
        }
        const wlDateSql = wlDateForStageDone.length ? `AND ${wlDateForStageDone.join(' AND ')}` : '';

        const summarySql = `
      ${cte}
      SELECT
        (SELECT COUNT(*)::int FROM filtered) AS total_segments,
        (SELECT COUNT(DISTINCT ticket_id)::int FROM filtered) AS unique_tickets,
        (SELECT COUNT(*)::int FROM filtered WHERE end_time IS NULL) AS active_segments,
        (SELECT COUNT(*)::int FROM filtered WHERE end_time IS NOT NULL) AS closed_segments
    `;

        const productivitySql = `
      ${ticketScopeCte}
      SELECT
        (SELECT COUNT(DISTINCT ts.assigned_user_id)::int FROM ticket_scope ts WHERE ts.assigned_user_id IS NOT NULL) AS technicians_with_work,
        (SELECT COUNT(*)::int FROM ticket_scope ts WHERE ts.assigned_user_id IS NOT NULL) AS total_assigned,
        (SELECT COUNT(*)::int FROM ticket_scope ts WHERE ts.ticket_status = 'in_progress') AS active_tickets,
        (SELECT COUNT(*)::int FROM ticket_scope ts WHERE ts.ticket_status = 'on_hold') AS pending_tickets,
        (SELECT COUNT(*)::int FROM ticket_scope ts WHERE ts.ticket_status = 'completed') AS completed_tickets,
        (SELECT COUNT(*)::int FROM (
          SELECT wl.ticket_id FROM work_logs wl
          INNER JOIN ticket_scope ts ON ts.ticket_id = wl.ticket_id
          GROUP BY wl.ticket_id HAVING COUNT(DISTINCT wl.user_id) > 1
        ) r) AS reassigned_tickets,
        (SELECT COUNT(DISTINCT wl.ticket_id)::int
          FROM work_logs wl
          INNER JOIN stages s ON s.stage_id = wl.stage_id
          INNER JOIN ticket_scope ts ON ts.ticket_id = wl.ticket_id
          WHERE wl.end_time IS NOT NULL AND s.stage_name = 'QC1' ${wlDateSql}) AS qc1_completed,
        (SELECT COUNT(*)::int FROM ticket_scope ts
          INNER JOIN stages s ON s.stage_id = ts.current_stage_id
          WHERE s.stage_name = 'QC1') AS qc1_at_stage,
        (SELECT COUNT(DISTINCT wl.ticket_id)::int
          FROM work_logs wl
          INNER JOIN stages s ON s.stage_id = wl.stage_id
          INNER JOIN ticket_scope ts ON ts.ticket_id = wl.ticket_id
          WHERE wl.end_time IS NOT NULL AND s.stage_name = 'QC2' ${wlDateSql}) AS qc2_completed,
        (SELECT COUNT(*)::int FROM ticket_scope ts
          INNER JOIN stages s ON s.stage_id = ts.current_stage_id
          WHERE s.stage_name = 'QC2') AS qc2_at_stage,
        (SELECT COUNT(DISTINCT wl.ticket_id)::int
          FROM work_logs wl
          INNER JOIN stages s ON s.stage_id = wl.stage_id
          INNER JOIN ticket_scope ts ON ts.ticket_id = wl.ticket_id
          WHERE wl.end_time IS NOT NULL AND s.stage_name = 'Diagnosis' ${wlDateSql}) AS diagnosis_completed,
        (SELECT COUNT(*)::int FROM ticket_scope ts
          INNER JOIN stages s ON s.stage_id = ts.current_stage_id
          WHERE s.stage_name = 'Diagnosis') AS diagnosis_at_stage,
        (SELECT COUNT(DISTINCT wl.ticket_id)::int
          FROM work_logs wl
          INNER JOIN stages s ON s.stage_id = wl.stage_id
          INNER JOIN ticket_scope ts ON ts.ticket_id = wl.ticket_id
          WHERE wl.end_time IS NOT NULL AND s.stage_name = 'Assembly & Software' ${wlDateSql}) AS assembly_completed,
        (SELECT COUNT(*)::int FROM ticket_scope ts
          INNER JOIN stages s ON s.stage_id = ts.current_stage_id
          WHERE s.stage_name = 'Assembly & Software') AS assembly_at_stage,
        (SELECT COUNT(DISTINCT wl.ticket_id)::int
          FROM work_logs wl
          INNER JOIN stages s ON s.stage_id = wl.stage_id
          INNER JOIN ticket_scope ts ON ts.ticket_id = wl.ticket_id
          WHERE wl.end_time IS NOT NULL AND s.stage_name = 'Chip Level Repair' ${wlDateSql}) AS chip_repair_completed,
        (SELECT COUNT(*)::int FROM ticket_scope ts
          INNER JOIN stages s ON s.stage_id = ts.current_stage_id
          WHERE s.stage_name = 'Chip Level Repair') AS chip_repair_at_stage,
        (SELECT COUNT(DISTINCT wl.ticket_id)::int
          FROM work_logs wl
          INNER JOIN stages s ON s.stage_id = wl.stage_id
          INNER JOIN ticket_scope ts ON ts.ticket_id = wl.ticket_id
          WHERE wl.end_time IS NOT NULL AND s.stage_name = 'Body & Paint' ${wlDateSql}) AS body_paint_completed,
        (SELECT COUNT(*)::int FROM ticket_scope ts
          INNER JOIN stages s ON s.stage_id = ts.current_stage_id
          WHERE s.stage_name = 'Body & Paint') AS body_paint_at_stage,
        (SELECT COUNT(DISTINCT wl.ticket_id)::int
          FROM work_logs wl
          INNER JOIN stages s ON s.stage_id = wl.stage_id
          INNER JOIN ticket_scope ts ON ts.ticket_id = wl.ticket_id
          WHERE wl.end_time IS NOT NULL AND s.stage_name = 'Final Testing' ${wlDateSql}) AS final_testing_completed,
        (SELECT COUNT(*)::int FROM ticket_scope ts
          INNER JOIN stages s ON s.stage_id = ts.current_stage_id
          WHERE s.stage_name = 'Final Testing') AS final_testing_at_stage,
        (SELECT COUNT(*)::int FROM ticket_scope ts WHERE ts.ticket_status = 'qc_failed_return_vendor') AS returned_to_vendor,
        (SELECT AVG(EXTRACT(EPOCH FROM (ts.ticket_completed_at - first_log.first_start)))::float
          FROM ticket_scope ts
          INNER JOIN (
            SELECT ticket_id, MIN(start_time) AS first_start
            FROM work_logs
            GROUP BY ticket_id
          ) first_log ON first_log.ticket_id = ts.ticket_id
          WHERE ts.ticket_completed_at IS NOT NULL) AS average_resolution_seconds,
        (SELECT AVG(EXTRACT(EPOCH FROM (wl.end_time - wl.start_time)))::float
          FROM work_logs wl
          INNER JOIN ticket_scope ts ON ts.ticket_id = wl.ticket_id
          INNER JOIN stages s ON s.stage_id = wl.stage_id
          WHERE wl.end_time IS NOT NULL
            AND s.stage_name IN (${stageNamesList})
            ${wlDateSql}) AS average_stage_seconds,
        (SELECT SUM(EXTRACT(EPOCH FROM (COALESCE(wl.end_time, CURRENT_TIMESTAMP) - wl.start_time)))::float
          FROM work_logs wl
          INNER JOIN ticket_scope ts ON ts.ticket_id = wl.ticket_id) AS total_working_seconds,
        (SELECT COUNT(*)::int FROM ticket_scope ts
          WHERE EXISTS (
            SELECT 1 FROM work_logs wl
            WHERE wl.ticket_id = ts.ticket_id AND wl.end_time IS NULL
          )) AS currently_working_tickets
    `;

        const stageAveragesSql = `
      ${ticketScopeCte}
      SELECT
        s.stage_name,
        s.stage_order,
        COUNT(*)::int AS segment_count,
        AVG(EXTRACT(EPOCH FROM (wl.end_time - wl.start_time)))::float AS average_seconds
      FROM ticket_scope ts
      INNER JOIN work_logs wl ON wl.ticket_id = ts.ticket_id
      INNER JOIN stages s ON s.stage_id = wl.stage_id
      WHERE wl.end_time IS NOT NULL
        AND s.stage_name NOT IN ('Floor Manager', 'Inventory', 'Dispatch QC')
        ${wlDateSql}
      GROUP BY s.stage_id, s.stage_name, s.stage_order
      ORDER BY s.stage_order ASC
    `;

        const breakdownSql = `
      ${ticketScopeCte}
      SELECT ts.ticket_status AS status, COUNT(*)::int AS cnt
      FROM ticket_scope ts
      GROUP BY ts.ticket_status
    `;

        const countSql = `
      ${ticketScopeCte}
      SELECT COUNT(*)::int AS total FROM ticket_scope
    `;

        const rowsSql = `
      ${ticketScopeCte}
      SELECT
        seg.log_id,
        ts.ticket_id,
        ts.assigned_user_id AS technician_id,
        au.name AS technician_name,
        at.team_name,
        seg.stage_id AS segment_stage_id,
        ws.stage_name AS stage_at_assignment,
        (SELECT MIN(wl2.start_time)
           FROM work_logs wl2
          WHERE wl2.ticket_id = ts.ticket_id
            AND wl2.user_id = ts.assigned_user_id) AS assignment_time,
        seg.start_time AS start_time,
        seg.end_time AS end_time,
        seg.start_time AS assigned_at,
        seg.end_time AS completed_at,
        EXTRACT(EPOCH FROM (COALESCE(seg.end_time, CURRENT_TIMESTAMP) - seg.start_time))::float AS duration_seconds,
        ts.ticket_status,
        ts.machine_number,
        ts.serial_number,
        COALESCE(NULLIF(TRIM(ts.ttspl_id), ''), ts.machine_number) AS ttspl_id,
        ts.current_stage_id,
        cs.stage_name AS current_stage_name,
        COALESCE(NULLIF(TRIM(cust.company_name), ''), NULLIF(TRIM(cust.name), ''), '—') AS customer_name,
        COALESCE(NULLIF(TRIM(vsn.qc_status), ''), NULLIF(TRIM(vsn.extra->>'status'), ''), '—') AS qc_status,
        su.name AS segment_technician_name
      FROM ticket_scope ts
      LEFT JOIN LATERAL (
        SELECT wl.log_id, wl.user_id, wl.stage_id, wl.start_time, wl.end_time
        FROM work_logs wl
        WHERE wl.ticket_id = ts.ticket_id
        ORDER BY CASE WHEN wl.end_time IS NULL THEN 0 ELSE 1 END, wl.start_time DESC
        LIMIT 1
      ) seg ON TRUE
      LEFT JOIN users au ON au.user_id = ts.assigned_user_id
      LEFT JOIN users su ON su.user_id = seg.user_id
      LEFT JOIN teams at ON at.team_id = ts.assigned_team_id
      LEFT JOIN stages ws ON ws.stage_id = seg.stage_id
      LEFT JOIN stages cs ON cs.stage_id = ts.current_stage_id
      LEFT JOIN vendor_serial_numbers vsn ON vsn.serial_id = ts.vendor_serial_id
      LEFT JOIN customers cust ON cust.customer_id = vsn.current_customer_id
      ORDER BY COALESCE(seg.start_time, to_timestamp(0)) DESC, ts.ticket_id DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

        const stagesSql = `SELECT stage_id, stage_name, stage_order FROM stages ORDER BY stage_order ASC`;

        const [sumRes, prodRes, stageAvgRes, breakRes, countRes, rowsRes, techRes, stagesRes, teamsList, workloadDashboard, dynamicSummary] = await Promise.all([
            pool.query(summarySql, params),
            pool.query(productivitySql, stageDoneParams),
            pool.query(stageAveragesSql, stageDoneParams),
            pool.query(breakdownSql, ticketScope.params),
            pool.query(countSql, ticketScope.params),
            pool.query(rowsSql, ticketScope.params),
            pool.query(techQuery.sql, techQuery.params),
            pool.query(stagesSql),
            getDisplayTeams(),
            fetchTeamWorkloadDashboard(reportQuery),
            fetchDynamicSummary(reportQuery)
        ]);

        const totalRows = countRes.rows[0]?.total ?? 0;
        const totalPages = Math.max(Math.ceil(totalRows / limit), 1);

        const summaryRow = sumRes.rows[0] || {};
        const prodRow = prodRes.rows[0] || {};
        const ticketStatusBreakdown = {};
        breakRes.rows.forEach((r) => {
            ticketStatusBreakdown[r.status] = r.cnt;
        });

        const stageAverages = stageAvgRes.rows.map((row) => ({
            stage_name: row.stage_name,
            segment_count: row.segment_count,
            average_seconds: row.average_seconds,
            average_human: formatDuration(row.average_seconds)
        }));

        const productivity = {
            total_technicians: techRes.rows.length,
            technicians_with_work: prodRow.technicians_with_work ?? 0,
            total_assigned: prodRow.total_assigned ?? 0,
            active_tickets: prodRow.active_tickets ?? 0,
            pending_tickets: prodRow.pending_tickets ?? 0,
            completed_tickets: prodRow.completed_tickets ?? 0,
            reassigned_tickets: prodRow.reassigned_tickets ?? 0,
            qc1_completed: prodRow.qc1_completed ?? 0,
            qc1_at_stage: prodRow.qc1_at_stage ?? 0,
            qc2_completed: prodRow.qc2_completed ?? 0,
            qc2_at_stage: prodRow.qc2_at_stage ?? 0,
            diagnosis_completed: prodRow.diagnosis_completed ?? 0,
            diagnosis_at_stage: prodRow.diagnosis_at_stage ?? 0,
            assembly_completed: prodRow.assembly_completed ?? 0,
            assembly_at_stage: prodRow.assembly_at_stage ?? 0,
            chip_repair_completed: prodRow.chip_repair_completed ?? 0,
            chip_repair_at_stage: prodRow.chip_repair_at_stage ?? 0,
            body_paint_completed: prodRow.body_paint_completed ?? 0,
            body_paint_at_stage: prodRow.body_paint_at_stage ?? 0,
            final_testing_completed: prodRow.final_testing_completed ?? 0,
            final_testing_at_stage: prodRow.final_testing_at_stage ?? 0,
            returned_to_vendor: prodRow.returned_to_vendor ?? 0,
            average_resolution_seconds: prodRow.average_resolution_seconds,
            average_resolution_human: formatDuration(prodRow.average_resolution_seconds),
            average_stage_seconds: prodRow.average_stage_seconds,
            average_stage_human: formatDuration(prodRow.average_stage_seconds),
            total_working_seconds: prodRow.total_working_seconds,
            total_working_human: formatDuration(prodRow.total_working_seconds),
            currently_working_tickets: prodRow.currently_working_tickets ?? 0,
            stage_averages: stageAverages
        };

        const rows = rowsRes.rows.map((row) => ({
            log_id: row.log_id,
            ticket_id: row.ticket_id,
            technician_id: row.technician_id,
            technician_name: row.technician_name,
            team_name: row.team_name || '—',
            customer_name: row.customer_name || '—',
            ttspl_id: row.ttspl_id || '—',
            machine_number: row.machine_number || '—',
            serial_number: row.serial_number || '—',
            stage_at_assignment: row.stage_at_assignment || '—',
            segment_status: row.completed_at ? 'completed' : 'active',
            assignment_time: row.assignment_time,
            start_time: row.start_time,
            end_time: row.end_time,
            assigned_at: row.assigned_at,
            completed_at: row.completed_at,
            duration_seconds: row.duration_seconds,
            duration_human: row.assigned_at ? formatDuration(row.duration_seconds) : '—',
            ticket_status: row.ticket_status,
            current_stage_name: row.current_stage_name || '—',
            qc_status: row.qc_status || '—',
            segment_technician_name: row.segment_technician_name || null
        }));

        const summary = {
            total_segments: summaryRow.total_segments ?? 0,
            unique_tickets: summaryRow.unique_tickets ?? 0,
            active_segments: summaryRow.active_segments ?? 0,
            closed_segments: summaryRow.closed_segments ?? 0,
            ticket_status_breakdown: ticketStatusBreakdown,
            date_range: workloadDashboard.date_range,
            productivity
        };

        res.json({
            success: true,
            summary,
            productivity,
            workload_dashboard: workloadDashboard,
            dynamic_summary: dynamicSummary,
            technician_summary: ['technicians', 'team'].includes(dynamicSummary.mode)
                ? (dynamicSummary.technicians || [])
                : [],
            summary_mode: dynamicSummary.mode,
            rows,
            pagination: {
                page,
                limit,
                total: totalRows,
                totalPages
            },
            technicians: techRes.rows,
            teams: teamsList,
            stages: stagesRes.rows,
            report: rows.map((r) => ({
                technician: r.technician_name,
                team: r.team_name,
                machine_number: r.machine_number,
                times_picked: 1,
                total_duration: r.duration_human,
                status: r.segment_status === 'active' ? 'Active' : 'Completed',
                ticket_id: r.ticket_id
            }))
        });
    } catch (error) {
        console.error('Report error:', error);
        res.status(500).json({ success: false, message: 'Server error generating report' });
    }
};

function parsePagination(query) {
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 50, 1), 500);
    const offset = (page - 1) * limit;
    return { page, limit, offset };
}

function defaultDateRange(query) {
    const { allTime, from, to } = resolveDateRange(query);
    return { from, to, allTime };
}

async function fetchRevenueData(query) {
    const { from, to } = defaultDateRange(query);
    const { page, limit, offset } = parsePagination(query);
    const conditions = ['ci.invoice_date >= $1::date', 'ci.invoice_date <= $2::date'];
    const params = [from, to];
    let idx = 3;

    if (query.customer_id) {
        const cid = parseInt(query.customer_id, 10);
        if (Number.isInteger(cid)) {
            conditions.push(`ci.customer_id = $${idx}`);
            params.push(cid);
            idx += 1;
        }
    }

    if (query.type === 'rental' || query.type === 'sale') {
        conditions.push(`EXISTS (
          SELECT 1 FROM delivery_challan_lines dcl
          WHERE dcl.customer_id = ci.customer_id
            AND dcl.quotation_type = $${idx}
        )`);
        params.push(query.type);
        idx += 1;
    }

    const whereSql = conditions.join(' AND ');

    const [countRes, rowsRes, totalsRes] = await Promise.all([
        pool.query(`SELECT COUNT(*)::int AS total FROM customer_invoices ci WHERE ${whereSql}`, params),
        pool.query(
            `SELECT ci.invoice_number, ci.invoice_month, ci.invoice_year, ci.subtotal, ci.gst_amount,
                    ci.credit_note_adjustment, ci.grand_total, ci.status, ci.invoice_date,
                    c.company_name AS customer_name, c.name AS contact_name
             FROM customer_invoices ci
             LEFT JOIN customers c ON c.customer_id = ci.customer_id
             WHERE ${whereSql}
             ORDER BY ci.invoice_date DESC
             LIMIT $${idx} OFFSET $${idx + 1}`,
            [...params, limit, offset]
        ),
        pool.query(
            `SELECT
              COALESCE(SUM(ci.grand_total), 0)::float AS invoiced,
              COALESCE(SUM(ci.grand_total) FILTER (WHERE ci.status = 'paid'), 0)::float AS collected,
              COALESCE(SUM(ci.grand_total) FILTER (WHERE ci.status NOT IN ('paid', 'cancelled')), 0)::float AS outstanding,
              COALESCE(SUM(ci.credit_note_adjustment), 0)::float AS credit_notes_applied
             FROM customer_invoices ci
             WHERE ${whereSql}`,
            params
        ),
    ]);

    // Rentfoxxy vs Gorefurbo split for the dashboard revenue chart.
    const byEntityRes = await pool.query(
        `SELECT COALESCE(ci.entity_code, 'rentfoxxy') AS entity_code,
                COALESCE(SUM(ci.grand_total), 0)::float AS invoiced,
                COALESCE(SUM(ci.grand_total) FILTER (WHERE ci.status = 'paid'), 0)::float AS collected,
                COALESCE(SUM(ci.grand_total) FILTER (WHERE ci.status NOT IN ('paid','cancelled')), 0)::float AS outstanding
           FROM customer_invoices ci
          WHERE ${whereSql}
          GROUP BY COALESCE(ci.entity_code, 'rentfoxxy')`,
        params
    );

    const total = countRes.rows[0]?.total || 0;
    return {
        invoices: rowsRes.rows,
        totals: totalsRes.rows[0] || {},
        by_entity: byEntityRes.rows,
        pagination: {
            page,
            limit,
            total,
            total_pages: Math.ceil(total / limit) || 1,
        },
    };
}

exports.getRevenueReport = async (req, res) => {
    try {
        const data = await fetchRevenueData(req.query);
        res.json({ success: true, ...data });
    } catch (error) {
        console.error('getRevenueReport error:', error);
        res.status(500).json({ success: false, message: 'Server error generating revenue report' });
    }
};

async function fetchInventoryUtilisationData() {
    const [summaryRes, brandRes, topCustomersRes] = await Promise.all([
        pool.query(
            `SELECT COUNT(*)::int AS total_fleet,
              COUNT(*) FILTER (WHERE inventory_status = 'out_stock')::int AS rented
             FROM vendor_serial_numbers
             WHERE deleted_at IS NULL`
        ),
        pool.query(
            `SELECT COALESCE(NULLIF(TRIM(extra->>'brand'), ''), NULLIF(TRIM(extra->>'brand_name'), ''), 'Unknown') AS brand,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE inventory_status = 'out_stock')::int AS rented,
              COUNT(*) FILTER (WHERE qc_status = 'qc_passed' AND inventory_status = 'in_stock')::int AS available,
              COUNT(*) FILTER (
                WHERE serial_number IN (
                  SELECT serial_number FROM tickets
                  WHERE status NOT IN ('completed', 'qc_failed_return_vendor', 'cancelled')
                )
              )::int AS in_repair
             FROM vendor_serial_numbers
             WHERE deleted_at IS NULL
             GROUP BY COALESCE(NULLIF(TRIM(extra->>'brand'), ''), NULLIF(TRIM(extra->>'brand_name'), ''), 'Unknown')
             ORDER BY total DESC`
        ),
        pool.query(
            `SELECT c.company_name AS customer_name,
              COUNT(DISTINCT dcl.serial_number)::int AS laptop_count,
              COALESCE(SUM(sol.rate), 0)::float AS monthly_value
             FROM delivery_challan_lines dcl
             JOIN customers c ON c.customer_id = dcl.customer_id
             LEFT JOIN sales_order_lines sol
               ON sol.sales_order_number = dcl.sales_order_number AND sol.brand = dcl.brand
             WHERE dcl.status = 'delivered'
             GROUP BY c.customer_id, c.company_name
             ORDER BY laptop_count DESC
             LIMIT 10`
        ),
    ]);

    const summaryRow = summaryRes.rows[0] || {};
    const totalFleet = summaryRow.total_fleet || 0;
    const rented = summaryRow.rented || 0;
    const avgUtilisedPct = totalFleet > 0
        ? parseFloat(((rented / totalFleet) * 100).toFixed(1))
        : 0;

    return {
        summary: { total_fleet: totalFleet, avg_utilised_pct: avgUtilisedPct },
        by_brand: brandRes.rows,
        top_customers: topCustomersRes.rows,
    };
}

exports.getInventoryUtilisationReport = async (req, res) => {
    try {
        const data = await fetchInventoryUtilisationData();
        res.json({ success: true, ...data });
    } catch (error) {
        console.error('getInventoryUtilisationReport error:', error);
        res.status(500).json({ success: false, message: 'Server error generating inventory report' });
    }
};

async function fetchLeadConversionData(query) {
    const { from, to } = defaultDateRange(query);
    const conditions = ['l.created_at >= $1::date', 'l.created_at < ($2::date + interval \'1 day\')'];
    const params = [from, to];
    let idx = 3;

    if (query.assigned_to) {
        const uid = parseInt(query.assigned_to, 10);
        if (Number.isInteger(uid)) {
            conditions.push(`l.assigned_user_id = $${idx}`);
            params.push(uid);
            idx += 1;
        }
    }

    const whereSql = conditions.join(' AND ');

    const [funnelRes, salespersonRes, stageRes, sourcesRes] = await Promise.all([
        pool.query(
            `SELECT status, COUNT(*)::int AS count
             FROM leads l
             WHERE ${whereSql}
             GROUP BY status
             ORDER BY count DESC`,
            params
        ),
        pool.query(
            `SELECT u.name AS user_name,
              COUNT(l.lead_id)::int AS total_leads,
              COUNT(l.lead_id) FILTER (WHERE l.status IN ('Deal', 'Demo'))::int AS converted,
              COUNT(l.lead_id) FILTER (WHERE l.status IN ('Gone', 'Rejected'))::int AS lost,
              ROUND(
                AVG(EXTRACT(EPOCH FROM (l.converted_at - l.created_at)) / 86400)
                  FILTER (WHERE l.converted_at IS NOT NULL)::numeric,
                1
              ) AS avg_days_to_convert
             FROM leads l
             LEFT JOIN users u ON u.user_id = l.assigned_user_id
             WHERE ${whereSql}
             GROUP BY u.user_id, u.name
             ORDER BY converted DESC`,
            params
        ),
        pool.query(
            `SELECT l.status,
              ROUND(AVG(EXTRACT(EPOCH FROM (NOW() - l.created_at)) / 86400)::numeric, 1) AS avg_days
             FROM leads l
             WHERE ${whereSql}
             GROUP BY l.status
             ORDER BY avg_days DESC`,
            params
        ),
        pool.query(
            `SELECT COALESCE(NULLIF(TRIM(l.source), ''), 'Unknown') AS source,
              COUNT(l.lead_id)::int AS count,
              COUNT(l.lead_id) FILTER (WHERE l.status IN ('Deal', 'Demo'))::int AS converted
             FROM leads l
             WHERE ${whereSql}
             GROUP BY COALESCE(NULLIF(TRIM(l.source), ''), 'Unknown')
             ORDER BY count DESC`,
            params
        ),
    ]);

    const totalLeads = funnelRes.rows.reduce((s, r) => s + (r.count || 0), 0);
    const funnel = funnelRes.rows.map((r) => ({
        status: r.status,
        count: r.count,
        pct_of_total: totalLeads > 0 ? parseFloat(((r.count / totalLeads) * 100).toFixed(1)) : 0,
    }));

    const bySalesperson = salespersonRes.rows.map((r) => {
        const total = r.total_leads || 0;
        const converted = r.converted || 0;
        return {
            ...r,
            conversion_rate_pct: total > 0 ? parseFloat(((converted / total) * 100).toFixed(1)) : 0,
            avg_days_to_convert: r.avg_days_to_convert != null ? parseFloat(r.avg_days_to_convert) : null,
        };
    });

    const sources = sourcesRes.rows.map((r) => {
        const count = r.count || 0;
        const converted = r.converted || 0;
        return {
            source: r.source,
            count,
            converted,
            conversion_rate_pct: count > 0 ? parseFloat(((converted / count) * 100).toFixed(1)) : 0,
        };
    });

    const avgDaysPerStage = stageRes.rows.map((r) => ({
        status: r.status,
        avg_days: r.avg_days != null ? parseFloat(r.avg_days) : 0,
    }));

    return { funnel, by_salesperson: bySalesperson, avg_days_per_stage: avgDaysPerStage, sources };
}

exports.getLeadConversionReport = async (req, res) => {
    try {
        const data = await fetchLeadConversionData(req.query);
        res.json({ success: true, ...data });
    } catch (error) {
        console.error('getLeadConversionReport error:', error);
        res.status(500).json({ success: false, message: 'Server error generating lead conversion report' });
    }
};

async function fetchSalespersonData(query, reqUser) {
    const { from, to } = defaultDateRange(query);
    const leadDateFilter = `l.created_at >= $1::date AND l.created_at < ($2::date + interval '1 day')`;
    const params = [from, to];
    let userFilter = '';
    let idx = 3;

    if (reqUser?.role === 'sales') {
        userFilter = `AND u.user_id = $${idx}`;
        params.push(reqUser.user_id);
        idx += 1;
    } else if (query.user_id) {
        const uid = parseInt(query.user_id, 10);
        if (Number.isInteger(uid)) {
            userFilter = `AND u.user_id = $${idx}`;
            params.push(uid);
            idx += 1;
        }
    }

    const resUsers = await pool.query(
        `SELECT u.user_id, u.name, u.role,
          COUNT(l.lead_id)::int AS total_leads,
          COUNT(l.lead_id) FILTER (WHERE l.status NOT IN ('Gone', 'Rejected', 'Deal', 'Demo'))::int AS active,
          COUNT(l.lead_id) FILTER (WHERE l.status IN ('Deal', 'Demo'))::int AS converted,
          COUNT(l.lead_id) FILTER (WHERE l.status IN ('Gone', 'Rejected'))::int AS lost,
          COUNT(l.lead_id) FILTER (
            WHERE l.status NOT IN ('Gone', 'Rejected', 'Deal', 'Demo')
              AND l.follow_up_date IS NOT NULL
              AND l.follow_up_date < NOW()
          )::int AS follow_up_overdue,
          COUNT(l.lead_id) FILTER (
            WHERE l.follow_up_date IS NOT NULL
          )::int AS follow_up_scheduled
         FROM users u
         LEFT JOIN leads l ON l.assigned_user_id = u.user_id AND ${leadDateFilter}
         WHERE u.role IN ('sales', 'manager', 'admin') AND COALESCE(u.active, true) = true
         ${userFilter}
         GROUP BY u.user_id, u.name, u.role
         HAVING COUNT(l.lead_id) > 0 OR u.role = 'sales'
         ORDER BY converted DESC`,
        params
    );

    const quotRes = await pool.query(
        `SELECT sq.created_by AS user_id,
          COUNT(DISTINCT sq.quotation_number) FILTER (WHERE sq.status IN ('sent', 'pending', 'approved'))::int AS sent,
          COUNT(DISTINCT sq.quotation_number) FILTER (WHERE sq.status = 'approved')::int AS approved,
          COUNT(DISTINCT sq.quotation_number) FILTER (WHERE sq.status = 'rejected')::int AS rejected
         FROM sales_quotations sq
         WHERE sq.created_at >= $1::date
           AND sq.created_at < ($2::date + interval '1 day')
         GROUP BY sq.created_by`,
        [from, to]
    );

    const quotMap = Object.fromEntries(quotRes.rows.map((r) => [r.user_id, r]));

    const salespeople = resUsers.rows.map((row) => {
        const q = quotMap[row.user_id] || {};
        const sent = q.sent || 0;
        const approved = q.approved || 0;
        return {
            user_id: row.user_id,
            name: row.name,
            role: row.role,
            leads: {
                total: row.total_leads || 0,
                active: row.active || 0,
                converted: row.converted || 0,
                lost: row.lost || 0,
            },
            quotations: {
                sent,
                approved,
                rejected: q.rejected || 0,
                hit_rate_pct: sent > 0 ? parseFloat(((approved / sent) * 100).toFixed(1)) : 0,
            },
            follow_ups: {
                scheduled: row.follow_up_scheduled || 0,
                overdue: row.follow_up_overdue || 0,
            },
        };
    });

    return { salespeople };
}

exports.getSalespersonReport = async (req, res) => {
    try {
        const data = await fetchSalespersonData(req.query, req.user);
        res.json({ success: true, ...data });
    } catch (error) {
        console.error('getSalespersonReport error:', error);
        res.status(500).json({ success: false, message: 'Server error generating salesperson report' });
    }
};

async function fetchCollectionsData(query) {
    const year = parseInt(query.year, 10) || new Date().getFullYear();
    const month = query.month ? parseInt(query.month, 10) : null;
    const conditions = ['ci.invoice_year = $1'];
    const params = [year];
    let idx = 2;

    if (month && month >= 1 && month <= 12) {
        conditions.push(`ci.invoice_month = $${idx}`);
        params.push(month);
        idx += 1;
    }

    if (query.customer_id) {
        const cid = parseInt(query.customer_id, 10);
        if (Number.isInteger(cid)) {
            conditions.push(`ci.customer_id = $${idx}`);
            params.push(cid);
            idx += 1;
        }
    }

    const whereSql = conditions.join(' AND ');

    const [summaryRes, byCustomerRes, trendRes] = await Promise.all([
        pool.query(
            `SELECT
              COALESCE(SUM(ci.grand_total), 0)::float AS total_invoiced,
              COALESCE(SUM(ci.grand_total) FILTER (WHERE ci.status = 'paid'), 0)::float AS total_collected,
              COALESCE(SUM(ci.grand_total) FILTER (WHERE ci.status NOT IN ('paid', 'cancelled')), 0)::float AS outstanding,
              COALESCE(SUM(ci.grand_total) FILTER (
                WHERE ci.status NOT IN ('paid', 'cancelled')
                  AND ci.invoice_date < (CURRENT_DATE - interval '30 days')
              ), 0)::float AS overdue
             FROM customer_invoices ci
             WHERE ${whereSql}`,
            params
        ),
        pool.query(
            `SELECT c.company_name AS customer_name,
              COALESCE(SUM(ci.grand_total), 0)::float AS invoiced,
              COALESCE(SUM(ci.grand_total) FILTER (WHERE ci.status = 'paid'), 0)::float AS collected,
              COALESCE(SUM(ci.grand_total) FILTER (WHERE ci.status NOT IN ('paid', 'cancelled')), 0)::float AS outstanding,
              MIN(ci.invoice_date) FILTER (WHERE ci.status NOT IN ('paid', 'cancelled')) AS oldest_unpaid_date,
              CASE
                WHEN COALESCE(SUM(ci.grand_total) FILTER (WHERE ci.status NOT IN ('paid', 'cancelled')), 0) = 0 THEN 'paid'
                WHEN MIN(ci.invoice_date) FILTER (WHERE ci.status NOT IN ('paid', 'cancelled')) < (CURRENT_DATE - interval '30 days') THEN 'overdue'
                ELSE 'outstanding'
              END AS status
             FROM customer_invoices ci
             JOIN customers c ON c.customer_id = ci.customer_id
             WHERE ${whereSql}
             GROUP BY c.customer_id, c.company_name
             ORDER BY outstanding DESC`,
            params
        ),
        pool.query(
            `SELECT ci.invoice_month AS month, ci.invoice_year AS year,
              COALESCE(SUM(ci.grand_total), 0)::float AS invoiced,
              COALESCE(SUM(ci.grand_total) FILTER (WHERE ci.status = 'paid'), 0)::float AS collected
             FROM customer_invoices ci
             WHERE ci.invoice_year = $1
             GROUP BY ci.invoice_month, ci.invoice_year
             ORDER BY ci.invoice_year, ci.invoice_month`,
            [year]
        ),
    ]);

    return {
        summary: summaryRes.rows[0] || {},
        by_customer: byCustomerRes.rows,
        monthly_trend: trendRes.rows,
    };
}

exports.getCollectionsReport = async (req, res) => {
    try {
        const data = await fetchCollectionsData(req.query);
        res.json({ success: true, ...data });
    } catch (error) {
        console.error('getCollectionsReport error:', error);
        res.status(500).json({ success: false, message: 'Server error generating collections report' });
    }
};

async function fetchVendorSpendData(query) {
    const { from, to } = defaultDateRange(query);
    const conditions = ['vmb.bill_date >= $1::date', 'vmb.bill_date <= $2::date'];
    const params = [from, to];
    let idx = 3;

    if (query.vendor_id) {
        const vid = parseInt(query.vendor_id, 10);
        if (Number.isInteger(vid)) {
            conditions.push(`vmb.vendor_id = $${idx}`);
            params.push(vid);
            idx += 1;
        }
    }

    const whereSql = conditions.join(' AND ');

    const [vendorsRes, trendRes, debitRes] = await Promise.all([
        pool.query(
            `SELECT v.business_name AS vendor_name,
              MAX(vpo.purchase_order_type) AS po_type,
              COUNT(vmb.bill_id)::int AS total_bills,
              COALESCE(SUM(vmb.total_payable), 0)::float AS total_payable,
              COALESCE(SUM(vmb.total_payable) FILTER (WHERE vmb.status = 'paid'), 0)::float AS total_paid,
              COALESCE(SUM(vmb.debit_note_adjustment), 0)::float AS debit_adjustments
             FROM vendor_monthly_bills vmb
             JOIN vendors v ON v.vendor_id = vmb.vendor_id
             LEFT JOIN vendor_purchase_orders vpo ON vpo.vendor_id = vmb.vendor_id
             WHERE ${whereSql}
             GROUP BY v.vendor_id, v.business_name
             ORDER BY total_payable DESC`,
            params
        ),
        pool.query(
            `SELECT vmb.bill_month AS month, vmb.bill_year AS year,
              COALESCE(SUM(vmb.total_payable), 0)::float AS total_payable
             FROM vendor_monthly_bills vmb
             WHERE ${whereSql}
             GROUP BY vmb.bill_month, vmb.bill_year
             ORDER BY vmb.bill_year, vmb.bill_month`,
            params
        ),
        pool.query(
            `SELECT COALESCE(SUM(vdn.amount), 0)::float AS debit_notes_total
             FROM vendor_debit_notes vdn
             WHERE vdn.created_at >= $1::date
               AND vdn.created_at < ($2::date + interval '1 day')`,
            [from, to]
        ),
    ]);

    const vendors = vendorsRes.rows.map((r) => ({
        ...r,
        net_payable: parseFloat((r.total_payable - r.debit_adjustments).toFixed(2)),
    }));

    return {
        vendors,
        monthly_trend: trendRes.rows,
        debit_notes_total: parseFloat(debitRes.rows[0]?.debit_notes_total || 0),
    };
}

exports.getVendorSpendReport = async (req, res) => {
    try {
        const data = await fetchVendorSpendData(req.query);
        res.json({ success: true, ...data });
    } catch (error) {
        console.error('getVendorSpendReport error:', error);
        res.status(500).json({ success: false, message: 'Server error generating vendor spend report' });
    }
};

function sheetFromRows(rows, headers) {
    const XLSX = require('xlsx');
    const mapped = rows.map((row) => {
        const out = {};
        headers.forEach((h) => {
            out[h.label] = row[h.key] ?? '';
        });
        return out;
    });
    const ws = XLSX.utils.json_to_sheet(mapped.length ? mapped : [{}]);
    ws['!cols'] = headers.map((h) => ({ wch: Math.max(String(h.label).length, 15) }));
    return ws;
}

exports.exportToExcel = async (req, res) => {
    try {
        const XLSX = require('xlsx');
        const { report_type: reportType, filters = {} } = req.body || {};
        const date = new Date().toISOString().slice(0, 10);
        let rows = [];
        let headers = [];
        let sheetName = 'Report';

        if (reportType === 'revenue') {
            const data = await fetchRevenueData({ ...filters, page: 1, limit: 5000 });
            rows = data.invoices;
            headers = [
                { key: 'invoice_number', label: 'Invoice #' },
                { key: 'customer_name', label: 'Customer' },
                { key: 'invoice_month', label: 'Month' },
                { key: 'invoice_year', label: 'Year' },
                { key: 'subtotal', label: 'Subtotal' },
                { key: 'gst_amount', label: 'GST' },
                { key: 'credit_note_adjustment', label: 'Credit Adj' },
                { key: 'grand_total', label: 'Total' },
                { key: 'status', label: 'Status' },
                { key: 'invoice_date', label: 'Date' },
            ];
            sheetName = 'Revenue';
        } else if (reportType === 'inventory') {
            const data = await fetchInventoryUtilisationData();
            rows = data.by_brand;
            headers = [
                { key: 'brand', label: 'Brand' },
                { key: 'total', label: 'Total' },
                { key: 'available', label: 'Available' },
                { key: 'rented', label: 'Rented' },
                { key: 'in_repair', label: 'In Repair' },
            ];
            sheetName = 'Inventory';
        } else if (reportType === 'lead_conversion') {
            const data = await fetchLeadConversionData(filters);
            rows = data.by_salesperson;
            headers = [
                { key: 'user_name', label: 'Salesperson' },
                { key: 'total_leads', label: 'Total Leads' },
                { key: 'converted', label: 'Converted' },
                { key: 'lost', label: 'Lost' },
                { key: 'conversion_rate_pct', label: 'Conv Rate %' },
                { key: 'avg_days_to_convert', label: 'Avg Days' },
            ];
            sheetName = 'Lead Conversion';
        } else if (reportType === 'salesperson') {
            const data = await fetchSalespersonData(filters, req.user);
            rows = data.salespeople.map((sp) => ({
                name: sp.name,
                role: sp.role,
                total_leads: sp.leads.total,
                active: sp.leads.active,
                converted: sp.leads.converted,
                lost: sp.leads.lost,
                quotations_sent: sp.quotations.sent,
                hit_rate_pct: sp.quotations.hit_rate_pct,
                follow_ups_overdue: sp.follow_ups.overdue,
            }));
            headers = [
                { key: 'name', label: 'Salesperson' },
                { key: 'role', label: 'Role' },
                { key: 'total_leads', label: 'Total Leads' },
                { key: 'active', label: 'Active' },
                { key: 'converted', label: 'Converted' },
                { key: 'lost', label: 'Lost' },
                { key: 'quotations_sent', label: 'Quotations Sent' },
                { key: 'hit_rate_pct', label: 'Hit Rate %' },
                { key: 'follow_ups_overdue', label: 'Overdue Follow-ups' },
            ];
            sheetName = 'Salesperson';
        } else if (reportType === 'collections') {
            const data = await fetchCollectionsData(filters);
            rows = data.by_customer;
            headers = [
                { key: 'customer_name', label: 'Customer' },
                { key: 'invoiced', label: 'Invoiced' },
                { key: 'collected', label: 'Collected' },
                { key: 'outstanding', label: 'Outstanding' },
                { key: 'oldest_unpaid_date', label: 'Oldest Unpaid' },
                { key: 'status', label: 'Status' },
            ];
            sheetName = 'Collections';
        } else if (reportType === 'vendor_spend') {
            const data = await fetchVendorSpendData(filters);
            rows = data.vendors;
            headers = [
                { key: 'vendor_name', label: 'Vendor' },
                { key: 'po_type', label: 'PO Type' },
                { key: 'total_bills', label: 'Bills' },
                { key: 'total_payable', label: 'Total Payable' },
                { key: 'total_paid', label: 'Paid' },
                { key: 'debit_adjustments', label: 'Debit Adj' },
                { key: 'net_payable', label: 'Net Payable' },
            ];
            sheetName = 'Vendor Spend';
        } else if (reportType === 'technician_performance') {
            const mockReq = { query: { ...filters, limit: 5000 } };
            let techRows = [];
            await new Promise((resolve, reject) => {
                const mockRes = {
                    json: (payload) => {
                        techRows = payload.rows || [];
                        resolve();
                    },
                    status: () => ({ json: reject }),
                };
                exports.getTechnicianPerformance(mockReq, mockRes).catch(reject);
            });
            rows = techRows.map((r) => ({
                technician: r.technician_name,
                team: r.team_name,
                machine: r.machine_number,
                stage: r.stage_at_assignment,
                status: r.segment_status,
                duration: r.duration_human,
                ticket_id: r.ticket_id,
            }));
            headers = [
                { key: 'technician', label: 'Technician' },
                { key: 'team', label: 'Team' },
                { key: 'machine', label: 'Machine' },
                { key: 'stage', label: 'Stage' },
                { key: 'status', label: 'Status' },
                { key: 'duration', label: 'Duration' },
                { key: 'ticket_id', label: 'Ticket ID' },
            ];
            sheetName = 'Technician';
        } else {
            return res.status(400).json({ success: false, message: 'Invalid report_type' });
        }

        const wb = XLSX.utils.book_new();
        const ws = sheetFromRows(rows, headers);
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${reportType}_${date}.xlsx"`);
        res.send(buf);
    } catch (error) {
        console.error('exportToExcel error:', error);
        res.status(500).json({ success: false, message: 'Server error exporting report' });
    }
};

exports.getSupportStats = async (req, res) => {
    try {
        const { from, to } = defaultDateRange(req.query);
        const params = [from, to];
        const dateFilter = `t.created_at >= $1::date AND t.created_at < ($2::date + interval '1 day')`;

        const [avgRes, techRes, catRes, repeatRes] = await Promise.all([
            pool.query(
                `SELECT
                  ROUND(AVG(EXTRACT(EPOCH FROM (i.resolved_at - t.created_at)) / 3600)
                    FILTER (WHERE i.resolved_at IS NOT NULL)::numeric, 1) AS avg_resolution_hours,
                  ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (
                    ORDER BY EXTRACT(EPOCH FROM (i.resolved_at - t.created_at)) / 3600
                  ) FILTER (WHERE i.resolved_at IS NOT NULL))::numeric, 1) AS median_resolution_hours
                 FROM support_tickets t
                 JOIN support_ticket_items i ON i.ticket_id = t.id
                 WHERE ${dateFilter}`,
                params
            ),
            pool.query(
                `SELECT u.name,
                  COUNT(DISTINCT t.id)::int AS tickets,
                  ROUND(AVG(EXTRACT(EPOCH FROM (i.resolved_at - t.created_at)) / 3600)
                    FILTER (WHERE i.resolved_at IS NOT NULL)::numeric, 1) AS avg_hours,
                  ROUND(
                    100.0 * COUNT(*) FILTER (
                      WHERE i.resolved_at IS NOT NULL
                        AND EXTRACT(EPOCH FROM (i.resolved_at - t.created_at)) / 3600 < 48
                    ) / NULLIF(COUNT(*) FILTER (WHERE i.resolved_at IS NOT NULL), 0),
                    1
                  ) AS under48h_pct
                 FROM support_ticket_items i
                 JOIN support_tickets t ON t.id = i.ticket_id
                 LEFT JOIN users u ON u.user_id = i.assigned_to
                 WHERE ${dateFilter}
                 GROUP BY u.user_id, u.name
                 HAVING COUNT(DISTINCT t.id) > 0
                 ORDER BY tickets DESC`,
                params
            ),
            pool.query(
                `SELECT COALESCE(i.issue_category_label, c.name, 'Uncategorized') AS label,
                  COUNT(*)::int AS count,
                  COUNT(*) FILTER (WHERE i.status IN ('resolved', 'closed', 'inventory_updated'))::int AS resolved,
                  COUNT(*) FILTER (WHERE i.status NOT IN ('resolved', 'closed', 'inventory_updated'))::int AS open,
                  ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(i.resolved_at, NOW()) - t.created_at)) / 3600)::numeric, 1) AS avg_hours
                 FROM support_ticket_items i
                 JOIN support_tickets t ON t.id = i.ticket_id
                 LEFT JOIN support_issue_categories c ON c.id = i.issue_category_id
                 WHERE ${dateFilter}
                 GROUP BY COALESCE(i.issue_category_label, c.name, 'Uncategorized')
                 ORDER BY count DESC`,
                params
            ),
            pool.query(
                `SELECT t.customer_name,
                  COUNT(DISTINCT t.id)::int AS total,
                  COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'closed')::int AS resolved,
                  ROUND(
                    100.0 * (COUNT(DISTINCT t.id) - 1) / NULLIF(COUNT(DISTINCT t.id), 0),
                    1
                  ) AS repeat_rate
                 FROM support_tickets t
                 WHERE ${dateFilter}
                 GROUP BY t.customer_id, t.customer_name
                 HAVING COUNT(DISTINCT t.id) > 1
                 ORDER BY total DESC
                 LIMIT 25`,
                params
            ),
        ]);

        const avgRow = avgRes.rows[0] || {};
        res.json({
            success: true,
            avg_resolution_hours: parseFloat(avgRow.avg_resolution_hours || 0),
            median_resolution_hours: parseFloat(avgRow.median_resolution_hours || 0),
            by_technician: techRes.rows.map((r) => ({
                name: r.name || 'Unassigned',
                tickets: r.tickets,
                avg_hours: r.avg_hours != null ? parseFloat(r.avg_hours) : null,
                under48h_pct: r.under48h_pct != null ? parseFloat(r.under48h_pct) : 0,
            })),
            by_category: catRes.rows.map((r) => ({
                label: r.label,
                count: r.count,
                resolved: r.resolved,
                open: r.open,
                avg_hours: r.avg_hours != null ? parseFloat(r.avg_hours) : 0,
            })),
            repeat_customers: repeatRes.rows.map((r) => ({
                customer_name: r.customer_name,
                total: r.total,
                resolved: r.resolved,
                repeat_rate: r.repeat_rate != null ? parseFloat(r.repeat_rate) : 0,
            })),
        });
    } catch (error) {
        console.error('getSupportStats error:', error);
        res.status(500).json({ success: false, message: 'Server error generating support stats' });
    }
};

exports.getLaptopReport = async (req, res) => {
    try {
        const data = await getLaptopReport(req.query);
        res.json({ success: true, ...data });
    } catch (error) {
        console.error('getLaptopReport error:', error);
        res.status(500).json({ success: false, message: error.message || 'Server error generating laptop report' });
    }
};

exports.getLaptopReportTickets = async (req, res) => {
    try {
        const q = req.query;
        if (q.popup_qc_history_failed === 'true' || q.popup_qc_history_failed === true || q.popup_status === 'QC Failed') {
            const { getQcFailedTickets } = require('../services/laptopReportStagePerformanceService');
            const data = await getQcFailedTickets(q);
            return res.json({ success: true, ...data });
        }
        if (q.stage_perf_stage || q.stage_performance_stage || q.stage_perf_bucket || q.stage_performance_bucket) {
            const data = await getStagePerformanceTickets(q);
            return res.json({ success: true, ...data });
        }
        const data = await getTicketRows(q);
        res.json({ success: true, ...data });
    } catch (error) {
        console.error('getLaptopReportTickets error:', error);
        res.status(500).json({ success: false, message: error.message || 'Server error loading laptop report tickets' });
    }
};

exports.getSalesOrderReport = async (req, res) => {
    try {
        const data = await getSalesOrderReport(req.query);
        res.json({ success: true, ...data });
    } catch (error) {
        console.error('getSalesOrderReport error:', error);
        res.status(500).json({ success: false, message: error.message || 'Server error generating sales order report' });
    }
};

exports.getSalesOrderReportDrilldown = async (req, res) => {
    try {
        const data = await getSalesOrderReportDrilldown(req.query);
        res.json({ success: true, ...data });
    } catch (error) {
        console.error('getSalesOrderReportDrilldown error:', error);
        res.status(500).json({ success: false, message: error.message || 'Server error loading drilldown' });
    }
};
