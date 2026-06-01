const pool = require('../config/db');

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

function buildFilter(query) {
    const conditions = [];
    const params = [];
    let idx = 1;

    const segmentStatus = query.segment_status === 'active'
        ? 'active'
        : query.segment_status === 'completed'
            ? 'completed'
            : '';

    ({ idx } = appendDateRangeConditions(conditions, params, idx, query, segmentStatus));

    if (query.user_id) {
        const uid = parseInt(query.user_id, 10);
        if (Number.isInteger(uid)) {
            conditions.push(`wl.user_id = $${idx}`);
            params.push(uid);
            idx += 1;
        }
    }

    if (query.ticket_status) {
        conditions.push(`t.status = $${idx}`);
        params.push(String(query.ticket_status));
        idx += 1;
    }

    if (segmentStatus === 'active') {
        conditions.push('wl.end_time IS NULL');
    } else if (segmentStatus === 'completed') {
        conditions.push('wl.end_time IS NOT NULL');
    }

    if (query.stage_id) {
        const sid = parseInt(query.stage_id, 10);
        if (Number.isInteger(sid)) {
            conditions.push(`wl.stage_id = $${idx}`);
            params.push(sid);
            idx += 1;
        }
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

const HW_STAGE_FILTER = `(s.stage_category = 'Hardware & Software' OR s.stage_name IN ('Diagnosis', 'Assembly & Software', 'Final Testing'))`;
const QC_STAGE_FILTER = `(s.stage_category = 'QC Team' OR s.stage_name IN ('QC1', 'QC2'))`;

/** Same filters as the segment table, without the date-range clause (for open-segment counts). */
function buildFilterWithoutDate(query) {
    const conditions = [];
    const params = [];
    let idx = 1;

    const segmentStatus = query.segment_status === 'active'
        ? 'active'
        : query.segment_status === 'completed'
            ? 'completed'
            : '';

    if (query.user_id) {
        const uid = parseInt(query.user_id, 10);
        if (Number.isInteger(uid)) {
            conditions.push(`wl.user_id = $${idx}`);
            params.push(uid);
            idx += 1;
        }
    }

    if (query.ticket_status) {
        conditions.push(`t.status = $${idx}`);
        params.push(String(query.ticket_status));
        idx += 1;
    }

    if (segmentStatus === 'active') {
        conditions.push('wl.end_time IS NULL');
    } else if (segmentStatus === 'completed') {
        conditions.push('wl.end_time IS NOT NULL');
    }

    if (query.stage_id) {
        const sid = parseInt(query.stage_id, 10);
        if (Number.isInteger(sid)) {
            conditions.push(`wl.stage_id = $${idx}`);
            params.push(sid);
            idx += 1;
        }
    }

    const whereSql = conditions.length ? conditions.join(' AND ') : 'TRUE';
    return { whereSql, params, idx, segmentStatus };
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
                qc2_segments: row.qc2_segments ?? 0
            };
            return out;
        })
        .filter((row) => metricKeys.some((k) => row[k] > 0))
        .sort((a, b) => a.name.localeCompare(b.name));

    return { members: membersOut, totals: sumMetrics(membersOut, metricKeys) };
}

async function queryCategoryWorkMetrics(query, categoryFilter) {
    const tableFilter = buildFilter(query);
    const openFilter = buildFilterWithoutDate(query);

    const joinFrom = `
      FROM work_logs wl
      INNER JOIN tickets t ON t.ticket_id = wl.ticket_id
      INNER JOIN stages s ON s.stage_id = wl.stage_id
      INNER JOIN users u ON u.user_id = wl.user_id
    `;

    const [tableRes, openRes] = await Promise.all([
        pool.query(
            `SELECT wl.user_id, u.name,
              COUNT(DISTINCT wl.ticket_id)::int AS total_tickets,
              COUNT(*) FILTER (WHERE wl.end_time IS NOT NULL)::int AS completed_segments,
              COUNT(*) FILTER (WHERE s.stage_name = 'QC1' AND wl.end_time IS NOT NULL)::int AS qc1_segments,
              COUNT(*) FILTER (WHERE s.stage_name = 'QC2' AND wl.end_time IS NOT NULL)::int AS qc2_segments
             ${joinFrom}
             WHERE (${tableFilter.whereSql}) AND ${categoryFilter}
             GROUP BY wl.user_id, u.name`,
            tableFilter.params
        ),
        pool.query(
            `SELECT wl.user_id, COUNT(*)::int AS active_till_today
             FROM work_logs wl
             INNER JOIN tickets t ON t.ticket_id = wl.ticket_id
             INNER JOIN stages s ON s.stage_id = wl.stage_id
             WHERE (${openFilter.whereSql}) AND ${categoryFilter} AND wl.end_time IS NULL
             GROUP BY wl.user_id`,
            openFilter.params
        )
    ]);

    const openMap = Object.fromEntries(openRes.rows.map((r) => [r.user_id, r.active_till_today]));

    const userIds = new Set([
        ...tableRes.rows.map((r) => r.user_id),
        ...openRes.rows.map((r) => r.user_id)
    ]);

    return [...userIds].map((userId) => {
        const main = tableRes.rows.find((r) => r.user_id === userId) || {};
        return {
            user_id: userId,
            name: main.name,
            total_tickets: main.total_tickets ?? 0,
            active_till_today: openMap[userId] ?? 0,
            completed_segments: main.completed_segments ?? 0,
            qc1_segments: main.qc1_segments ?? 0,
            qc2_segments: main.qc2_segments ?? 0
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

async function fetchTeamWorkloadDashboard(query) {
    const HW_METRIC_KEYS = ['total_tickets', 'active_till_today', 'completed_segments', 'chip_tickets', 'body_tickets'];
    const QC_METRIC_KEYS = ['total_tickets', 'active_till_today', 'completed_segments', 'qc1_segments', 'qc2_segments'];

    const [hwMembersRes, qcMembersRes, hwWork, qcWork, dxRows] = await Promise.all([
        pool.query(HW_MEMBERS_SQL),
        pool.query(QC_MEMBERS_SQL),
        queryCategoryWorkMetrics(query, HW_STAGE_FILTER),
        queryCategoryWorkMetrics(query, QC_STAGE_FILTER),
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
        const { whereSql, params } = buildFilter(req.query);
        const limit = Math.min(parseInt(req.query.limit, 10) || 2000, 5000);

        const cte = `
      WITH filtered AS (
        SELECT
          wl.log_id,
          wl.ticket_id,
          wl.user_id,
          wl.stage_id,
          wl.start_time,
          wl.end_time,
          t.status AS ticket_status,
          t.machine_number,
          t.serial_number,
          t.current_stage_id
        FROM work_logs wl
        INNER JOIN tickets t ON t.ticket_id = wl.ticket_id
        WHERE ${whereSql}
      )
    `;

        const summarySql = `
      ${cte}
      SELECT
        (SELECT COUNT(*)::int FROM filtered) AS total_segments,
        (SELECT COUNT(DISTINCT ticket_id)::int FROM filtered) AS unique_tickets,
        (SELECT COUNT(*)::int FROM filtered WHERE end_time IS NULL) AS active_segments,
        (SELECT COUNT(*)::int FROM filtered WHERE end_time IS NOT NULL) AS closed_segments
    `;

        const breakdownSql = `
      ${cte}
      SELECT ti.status, COUNT(DISTINCT ti.ticket_id)::int AS cnt
      FROM tickets ti
      WHERE ti.ticket_id IN (SELECT ticket_id FROM filtered)
      GROUP BY ti.status
    `;

        const rowsSql = `
      ${cte}
      SELECT
        f.log_id,
        f.ticket_id,
        f.user_id AS technician_id,
        u.name AS technician_name,
        tm.team_name,
        f.stage_id AS segment_stage_id,
        ws.stage_name AS stage_at_assignment,
        f.start_time AS assigned_at,
        f.end_time AS completed_at,
        EXTRACT(EPOCH FROM (COALESCE(f.end_time, CURRENT_TIMESTAMP) - f.start_time))::float AS duration_seconds,
        f.ticket_status,
        f.machine_number,
        f.serial_number,
        f.current_stage_id,
        cs.stage_name AS current_stage_name
      FROM filtered f
      INNER JOIN users u ON u.user_id = f.user_id
      LEFT JOIN teams tm ON tm.team_id = u.team_id
      LEFT JOIN stages ws ON ws.stage_id = f.stage_id
      LEFT JOIN stages cs ON cs.stage_id = f.current_stage_id
      ORDER BY f.start_time DESC
      LIMIT ${limit}
    `;

        const stagesSql = `SELECT stage_id, stage_name, stage_order FROM stages ORDER BY stage_order ASC`;

        const [sumRes, breakRes, rowsRes, techRes, stagesRes, workloadDashboard] = await Promise.all([
            pool.query(summarySql, params),
            pool.query(breakdownSql, params),
            pool.query(rowsSql, params),
            pool.query(STAGE_TECHNICIANS_SQL),
            pool.query(stagesSql),
            fetchTeamWorkloadDashboard(req.query)
        ]);

        const summaryRow = sumRes.rows[0] || {};
        const ticketStatusBreakdown = {};
        breakRes.rows.forEach((r) => {
            ticketStatusBreakdown[r.status] = r.cnt;
        });

        const rows = rowsRes.rows.map((row) => ({
            log_id: row.log_id,
            ticket_id: row.ticket_id,
            technician_id: row.technician_id,
            technician_name: row.technician_name,
            team_name: row.team_name || '—',
            machine_number: row.machine_number || row.serial_number || '—',
            serial_number: row.serial_number,
            stage_at_assignment: row.stage_at_assignment || '—',
            segment_status: row.completed_at ? 'completed' : 'active',
            assigned_at: row.assigned_at,
            completed_at: row.completed_at,
            duration_seconds: row.duration_seconds,
            duration_human: formatDuration(row.duration_seconds),
            ticket_status: row.ticket_status,
            current_stage_name: row.current_stage_name || '—'
        }));

        const summary = {
            total_segments: summaryRow.total_segments ?? 0,
            unique_tickets: summaryRow.unique_tickets ?? 0,
            active_segments: summaryRow.active_segments ?? 0,
            closed_segments: summaryRow.closed_segments ?? 0,
            ticket_status_breakdown: ticketStatusBreakdown,
            date_range: workloadDashboard.date_range
        };

        res.json({
            success: true,
            summary,
            workload_dashboard: workloadDashboard,
            rows,
            technicians: techRes.rows,
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
