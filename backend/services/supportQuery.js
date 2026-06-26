const pool = require('../config/db');
const { isSupportLead, isSupportTechnician } = require('../middleware/supportAccess');
const { appendSupportAssignedFilter, scopeUserId } = require('./dataScopeService');

const DEFAULT_OVERDUE_HOURS = 48;

const activityAtSql = `
    GREATEST(
        COALESCE(t.last_activity_at, t.updated_at, t.created_at),
        COALESCE((SELECT MAX(i.updated_at) FROM support_ticket_items i WHERE i.ticket_id = t.id), t.created_at),
        COALESCE((
            SELECT MAX(c.created_at) FROM support_ticket_item_comments c
            JOIN support_ticket_items si ON si.id = c.item_id
            WHERE si.ticket_id = t.id
        ), t.created_at)
    )
`;

const getSettings = async () => {
    const { rows } = await pool.query('SELECT key, value FROM support_settings');
    const map = {};
    for (const r of rows) map[r.key] = r.value;
    return {
        auto_close_enabled: map.auto_close_enabled !== false,
        overdue_threshold_hours: Number(map.overdue_threshold_hours) || DEFAULT_OVERDUE_HOURS,
        msr91_enabled: map.msr91_enabled === true
    };
};

const ticketSelectCore = (overdueHours) => `
    SELECT t.*,
        EXTRACT(EPOCH FROM (NOW() - ${activityAtSql})) / 3600.0 AS hours_since_last_update,
        (t.status <> 'closed' AND EXTRACT(EPOCH FROM (NOW() - ${activityAtSql})) / 3600.0 >= ${Number(overdueHours)}) AS is_overdue,
        (SELECT COUNT(*)::int FROM support_ticket_items i WHERE i.ticket_id = t.id) AS item_count,
        (SELECT COUNT(*)::int FROM support_ticket_items i WHERE i.ticket_id = t.id AND i.status IN ('resolved','closed')) AS resolved_item_count,
        (SELECT COUNT(*)::int FROM support_ticket_items i WHERE i.ticket_id = t.id AND i.status NOT IN ('resolved','closed')) AS open_item_count,
        (SELECT COUNT(*)::int FROM support_ticket_items i WHERE i.ticket_id = t.id AND i.assigned_to IS NULL AND i.status NOT IN ('resolved','closed')) AS unassigned_item_count,
        EXISTS (
            SELECT 1 FROM support_ticket_items i
            WHERE i.ticket_id = t.id AND i.item_type = 'replacement' AND i.status NOT IN ('resolved','closed')
        ) AS has_replacement_pending,
        u.name AS created_by_name
    FROM support_tickets t
    LEFT JOIN users u ON u.user_id = t.created_by
`;

const attachItems = async (tickets) => {
    if (!tickets.length) return tickets;
    const ids = tickets.map((t) => t.id);
    const { rows } = await pool.query(
        `SELECT i.id, i.ticket_id, i.item_type, i.status, i.brand, i.model, i.serial_number, i.unique_serial_number,
                i.assigned_to, i.loan_delivered_at, i.pickup_scheduled_at, i.updated_at, i.replacement_flag_reason,
                i.visited_at, i.visited_lat, i.visited_lng, i.ttspl_verified, i.outcome,
                i.pod_image_path, i.proof_of_completion_path,
                ut.name AS assigned_to_name
         FROM support_ticket_items i
         LEFT JOIN users ut ON ut.user_id = i.assigned_to
         WHERE i.ticket_id = ANY($1::int[])
         ORDER BY i.id ASC`,
        [ids]
    );
    const byTicket = {};
    for (const row of rows) {
        if (!byTicket[row.ticket_id]) byTicket[row.ticket_id] = [];
        byTicket[row.ticket_id].push(row);
    }
    return tickets.map((t) => ({
        ...t,
        items: byTicket[t.id] || [],
        display_phone: t.ticket_phone_override || t.customer_phone
    }));
};

const applyViewFilter = (view, params, user, overdueHours, { assignedOnly = false } = {}) => {
    let extra = '';
    const userId = scopeUserId(user);
    if (assignedOnly && userId) {
        extra += appendSupportAssignedFilter(userId, params);
    }
    switch (view) {
        case 'pending_assign':
            extra += ` AND t.status <> 'closed' AND EXISTS (
                SELECT 1 FROM support_ticket_items i WHERE i.ticket_id = t.id AND i.assigned_to IS NULL AND i.status NOT IN ('resolved','closed')
            )`;
            break;
        case 'overdue':
            params.push(overdueHours);
            extra += ` AND t.status <> 'closed' AND EXTRACT(EPOCH FROM (NOW() - ${activityAtSql})) / 3600.0 >= $${params.length}`;
            break;
        case 'pickups':
            extra += ` AND EXISTS (SELECT 1 FROM support_ticket_items i WHERE i.ticket_id = t.id AND i.item_type = 'pickup')`;
            break;
        case 'complaints':
            extra += ` AND EXISTS (SELECT 1 FROM support_ticket_items i WHERE i.ticket_id = t.id AND i.item_type = 'complaint')`;
            break;
        case 'replacements':
            extra += ` AND EXISTS (SELECT 1 FROM support_ticket_items i WHERE i.ticket_id = t.id AND i.item_type = 'replacement')`;
            break;
        case 'my_open':
            params.push(user.user_id);
            extra += ` AND t.status <> 'closed' AND EXISTS (
                SELECT 1 FROM support_ticket_items i WHERE i.ticket_id = t.id AND i.assigned_to = $${params.length} AND i.status NOT IN ('resolved','closed')
            )`;
            break;
        case 'my_resolved':
            params.push(user.user_id);
            extra += ` AND EXISTS (
                SELECT 1 FROM support_ticket_items i WHERE i.ticket_id = t.id AND i.assigned_to = $${params.length} AND i.status IN ('resolved','closed')
            ) AND COALESCE(t.closed_at, t.updated_at) >= NOW() - INTERVAL '30 days'`;
            break;
        case 'closed':
            extra += ` AND t.status = 'closed'`;
            break;
        case 'all':
            break;
        case 'active':
        default:
            extra += ` AND t.status <> 'closed'`;
            break;
    }
    return extra;
};

const listTicketsEnriched = async ({ user, view = 'active', search = '', type = '', limit = 50, offset = 0, closedDays = 30, assignedOnly = false }) => {
    const settings = await getSettings();
    const params = [];
    let where = 'WHERE 1=1';
    where += applyViewFilter(view, params, user, settings.overdue_threshold_hours, { assignedOnly });

    if (search) {
        params.push(`%${search}%`);
        const idx = params.length;
        where += ` AND (
            t.customer_name ILIKE $${idx}
            OR t.ticket_phone_override ILIKE $${idx}
            OR t.customer_phone ILIKE $${idx}
            OR CAST(t.id AS TEXT) LIKE $${idx}
            OR EXISTS (
                SELECT 1 FROM support_ticket_items si
                LEFT JOIN users ut ON ut.user_id = si.assigned_to
                WHERE si.ticket_id = t.id AND (
                    si.serial_number ILIKE $${idx}
                    OR si.unique_serial_number ILIKE $${idx}
                    OR ut.name ILIKE $${idx}
                )
            )
        )`;
    }

    if (['complaint', 'pickup', 'replacement'].includes(type)) {
        params.push(type);
        where += ` AND EXISTS (SELECT 1 FROM support_ticket_items i WHERE i.ticket_id = t.id AND i.item_type = $${params.length})`;
    }

    if (view === 'closed' || view === 'my_resolved') {
        params.push(closedDays);
        where += ` AND COALESCE(t.closed_at, t.updated_at) >= NOW() - ($${params.length} || ' days')::interval`;
    }

    const countSql = `SELECT COUNT(*)::int AS total FROM support_tickets t ${where}`;
    const countRes = await pool.query(countSql, params);

    params.push(limit, offset);
    const listSql = `
        ${ticketSelectCore(settings.overdue_threshold_hours)}
        ${where}
        ORDER BY
            CASE WHEN t.priority = 'urgent' THEN 0 WHEN t.priority = 'high' THEN 1 ELSE 2 END,
            is_overdue DESC,
            t.updated_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const listRes = await pool.query(listSql, params);
    const tickets = await attachItems(listRes.rows);

    return {
        total: countRes.rows[0]?.total || 0,
        limit,
        offset,
        settings,
        tickets
    };
};

const dashboardSummary = async (user) => {
    const settings = await getSettings();
    const oh = settings.overdue_threshold_hours;
    const techOnly = isSupportTechnician(user) && !isSupportLead(user);
    const techId = user.user_id;

    const techTicketExists = techOnly
        ? `EXISTS (SELECT 1 FROM support_ticket_items i WHERE i.ticket_id = t.id AND i.assigned_to = ${techId})`
        : 'TRUE';

    const q = await pool.query(
        `
        SELECT
            (SELECT COUNT(*)::int FROM support_tickets t WHERE t.status <> 'closed' AND ${techTicketExists}) AS open_total,
            (SELECT COUNT(*)::int FROM support_tickets t WHERE t.status <> 'closed' AND ${techTicketExists}
                AND EXTRACT(EPOCH FROM (NOW() - ${activityAtSql})) / 3600.0 >= $1) AS overdue_total,
            (SELECT COUNT(*)::int FROM support_ticket_items i
                JOIN support_tickets t ON t.id = i.ticket_id
                WHERE i.status IN ('resolved','closed') AND i.resolved_at::date = CURRENT_DATE
                AND ${techOnly ? `i.assigned_to = ${techId}` : 'TRUE'}) AS resolved_today,
            (SELECT COUNT(*)::int FROM support_ticket_items i
                JOIN support_tickets t ON t.id = i.ticket_id
                WHERE i.status IN ('resolved','closed') AND i.resolved_at::date = CURRENT_DATE - 1
                AND ${techOnly ? `i.assigned_to = ${techId}` : 'TRUE'}) AS resolved_yesterday,
            (SELECT COUNT(*)::int FROM support_ticket_items i
                JOIN support_tickets t ON t.id = i.ticket_id
                WHERE i.item_type = 'pickup' AND i.status NOT IN ('resolved','closed')
                AND ${techOnly ? `i.assigned_to = ${techId}` : 'TRUE'}) AS pending_pickups,
            (SELECT COUNT(*)::int FROM support_tickets t WHERE t.status <> 'closed' AND ${techTicketExists}
                AND EXISTS (SELECT 1 FROM support_ticket_items i WHERE i.ticket_id = t.id AND i.assigned_to IS NULL AND i.status NOT IN ('resolved','closed'))) AS unassigned_tickets
        `,
        [oh]
    );

    return { ...(q.rows[0] || {}), settings };
};

const navBadges = async (user) => {
    const settings = await getSettings();
    const oh = settings.overdue_threshold_hours;
    if (isSupportTechnician(user) && !isSupportLead(user)) {
        const { rows } = await pool.query(
            `
            SELECT
                (SELECT COUNT(DISTINCT t.id)::int FROM support_tickets t
                    JOIN support_ticket_items i ON i.ticket_id = t.id
                    WHERE i.assigned_to = $1 AND t.status <> 'closed' AND i.status NOT IN ('resolved','closed')) AS my_open,
                (SELECT COUNT(DISTINCT t.id)::int FROM support_tickets t
                    JOIN support_ticket_items i ON i.ticket_id = t.id
                    WHERE i.assigned_to = $1 AND i.status IN ('resolved','closed')
                    AND COALESCE(t.closed_at, t.updated_at) >= NOW() - INTERVAL '30 days') AS my_resolved
            `,
            [user.user_id]
        );
        return rows[0] || {};
    }
    const { rows } = await pool.query(
        `
        SELECT
            (SELECT COUNT(*)::int FROM support_tickets WHERE status <> 'closed') AS open_tickets,
            (SELECT COUNT(*)::int FROM support_tickets t WHERE status <> 'closed'
                AND EXTRACT(EPOCH FROM (NOW() - ${activityAtSql})) / 3600.0 >= $1) AS overdue_tickets,
            (SELECT COUNT(*)::int FROM support_tickets t WHERE status <> 'closed'
                AND EXISTS (SELECT 1 FROM support_ticket_items i WHERE i.ticket_id = t.id AND i.assigned_to IS NULL AND i.status NOT IN ('resolved','closed'))) AS pending_assign,
            (SELECT COUNT(*)::int FROM support_part_requests
                WHERE status IN ('pending','return_requested')
                   OR (reassign_requested_at IS NOT NULL AND status IN ('issued','return_requested'))) AS support_part_requests
        `,
        [oh]
    );
    return rows[0] || {};
};

module.exports = {
    getSettings,
    listTicketsEnriched,
    dashboardSummary,
    navBadges
};
