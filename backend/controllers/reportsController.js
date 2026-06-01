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

async function fetchTeamOverview(query) {
    const { allTime, from, to } = resolveDateRange(query);
    const techRes = await pool.query(STAGE_TECHNICIANS_SQL);
    const technicians = techRes.rows;

    if (technicians.length === 0) {
        return [];
    }

    const activeRes = await pool.query(
        `SELECT wl.user_id, COUNT(*)::int AS cnt
         FROM work_logs wl
         WHERE wl.end_time IS NULL
         GROUP BY wl.user_id`
    );
    const activeMap = Object.fromEntries(activeRes.rows.map((r) => [r.user_id, r.cnt]));

    let pendingMap = {};
    let doneMap = {};

    if (!allTime) {
        const pendingRes = await pool.query(
            `SELECT wl.user_id, COUNT(*)::int AS cnt
             FROM work_logs wl
             WHERE wl.end_time IS NULL
               AND wl.start_time >= $1::date
               AND wl.start_time < ($2::date + interval '1 day')
             GROUP BY wl.user_id`,
            [from, to]
        );
        pendingMap = Object.fromEntries(pendingRes.rows.map((r) => [r.user_id, r.cnt]));

        const doneRes = await pool.query(
            `SELECT wl.user_id, COUNT(*)::int AS cnt
             FROM work_logs wl
             WHERE wl.end_time IS NOT NULL
               AND wl.end_time >= $1::date
               AND wl.end_time < ($2::date + interval '1 day')
             GROUP BY wl.user_id`,
            [from, to]
        );
        doneMap = Object.fromEntries(doneRes.rows.map((r) => [r.user_id, r.cnt]));
    }

    return technicians.map((t) => ({
        user_id: t.user_id,
        name: t.name,
        active_till_today: activeMap[t.user_id] ?? 0,
        pending_in_range: allTime ? (activeMap[t.user_id] ?? 0) : (pendingMap[t.user_id] ?? 0),
        done_in_range: allTime ? 0 : (doneMap[t.user_id] ?? 0)
    }));
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

        const [sumRes, breakRes, rowsRes, techRes, stagesRes, teamOverview] = await Promise.all([
            pool.query(summarySql, params),
            pool.query(breakdownSql, params),
            pool.query(rowsSql, params),
            pool.query(STAGE_TECHNICIANS_SQL),
            pool.query(stagesSql),
            fetchTeamOverview(req.query)
        ]);

        const summaryRow = sumRes.rows[0] || {};
        const ticketStatusBreakdown = {};
        breakRes.rows.forEach((r) => {
            ticketStatusBreakdown[r.status] = r.cnt;
        });

        const overviewTotals = teamOverview.reduce(
            (acc, row) => ({
                active_till_today: acc.active_till_today + row.active_till_today,
                pending_in_range: acc.pending_in_range + row.pending_in_range,
                done_in_range: acc.done_in_range + row.done_in_range
            }),
            { active_till_today: 0, pending_in_range: 0, done_in_range: 0 }
        );

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

        const { allTime, from, to } = resolveDateRange(req.query);
        const summary = {
            total_segments: summaryRow.total_segments ?? 0,
            unique_tickets: summaryRow.unique_tickets ?? 0,
            active_segments: summaryRow.active_segments ?? 0,
            closed_segments: summaryRow.closed_segments ?? 0,
            ticket_status_breakdown: ticketStatusBreakdown,
            team_overview_totals: overviewTotals,
            date_range: allTime ? null : { from, to }
        };

        res.json({
            success: true,
            summary,
            team_overview: teamOverview,
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
