const pool = require('../config/db');
const { isSupportLead, isSupportTechnician } = require('../middleware/supportAccess');
const { appendSupportAssignedFilter, scopeUserId } = require('./dataScopeService');

const DEFAULT_OVERDUE_HOURS = 48;

const ACTIVE_TICKET_STATUSES = `t.status NOT IN ('closed', 'cancelled')`;

const pickupKindSql = `COALESCE(i.pickup_type, CASE WHEN i.source_item_id IS NOT NULL THEN 'repair' ELSE 'return' END)`;

const resolvePickupKind = (item) => {
    if (item.item_type !== 'pickup') return null;
    return item.pickup_type || (item.source_item_id ? 'repair' : 'return');
};

const deriveTicketPickupKind = (items = []) => {
    const kinds = [...new Set(items.filter((i) => i.item_type === 'pickup').map(resolvePickupKind).filter(Boolean))];
    if (!kinds.length) return null;
    if (kinds.length === 1) return kinds[0];
    return 'mixed';
};

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
        (t.status NOT IN ('closed', 'cancelled') AND EXTRACT(EPOCH FROM (NOW() - ${activityAtSql})) / 3600.0 >= ${Number(overdueHours)}) AS is_overdue,
        (SELECT COUNT(*)::int FROM support_ticket_items i WHERE i.ticket_id = t.id) AS item_count,
        (SELECT COUNT(*)::int FROM support_ticket_items i WHERE i.ticket_id = t.id AND i.status IN ('resolved','closed')) AS resolved_item_count,
        (SELECT COUNT(*)::int FROM support_ticket_items i WHERE i.ticket_id = t.id AND i.status NOT IN ('resolved','closed')) AS open_item_count,
        (SELECT COUNT(*)::int FROM support_ticket_items i WHERE i.ticket_id = t.id AND i.assigned_to IS NULL AND i.status NOT IN ('resolved','closed')) AS unassigned_item_count,
        EXISTS (
            SELECT 1 FROM support_ticket_items i
            WHERE i.ticket_id = t.id AND i.item_type = 'replacement' AND i.status NOT IN ('resolved','closed')
        ) AS has_replacement_pending,
        u.name AS created_by_name,
        cx.name AS cancelled_by_name
    FROM support_tickets t
    LEFT JOIN users u ON u.user_id = t.created_by
    LEFT JOIN users cx ON cx.user_id = t.cancelled_by
`;

const attachItems = async (tickets) => {
    if (!tickets.length) return tickets;
    const ids = tickets.map((t) => t.id);
    const { rows } = await pool.query(
        `SELECT i.id, i.ticket_id, i.item_type, i.status, i.brand, i.model, i.serial_number, i.unique_serial_number,
                i.assigned_to, i.pickup_method, i.pickup_type, i.source_item_id,
                i.loan_delivered_at, i.pickup_scheduled_at, i.updated_at, i.replacement_flag_reason,
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
    return tickets.map((t) => {
        const items = byTicket[t.id] || [];
        const pickup_kind = deriveTicketPickupKind(items);
        return {
            ...t,
            items,
            pickup_kind,
            pickup_kind_label: pickup_kind === 'repair'
                ? 'Repair Pickup'
                : pickup_kind === 'return'
                    ? 'Return Pickup'
                    : pickup_kind === 'mixed'
                        ? 'Mixed Pickup'
                        : null,
            display_phone: t.ticket_phone_override || t.customer_phone
        };
    });
};

const applyViewFilter = (view, params, user, overdueHours, { assignedOnly = false } = {}) => {
    let extra = '';
    const userId = scopeUserId(user);
    if (assignedOnly && userId) {
        extra += appendSupportAssignedFilter(userId, params);
    }
    switch (view) {
        case 'cancelled':
            extra += ` AND t.status = 'cancelled'`;
            break;
        case 'pending_assign':
            extra += ` AND ${ACTIVE_TICKET_STATUSES} AND EXISTS (
                SELECT 1 FROM support_ticket_items i WHERE i.ticket_id = t.id AND i.assigned_to IS NULL AND i.status NOT IN ('resolved','closed','cancelled')
            )`;
            break;
        case 'overdue':
            params.push(overdueHours);
            extra += ` AND ${ACTIVE_TICKET_STATUSES} AND EXTRACT(EPOCH FROM (NOW() - ${activityAtSql})) / 3600.0 >= $${params.length}`;
            break;
        case 'pickups':
            extra += ` AND ${ACTIVE_TICKET_STATUSES} AND EXISTS (SELECT 1 FROM support_ticket_items i WHERE i.ticket_id = t.id AND i.item_type = 'pickup')`;
            break;
        case 'complaints':
            extra += ` AND ${ACTIVE_TICKET_STATUSES} AND EXISTS (SELECT 1 FROM support_ticket_items i WHERE i.ticket_id = t.id AND i.item_type = 'complaint')`;
            break;
        case 'replacements':
            extra += ` AND ${ACTIVE_TICKET_STATUSES} AND EXISTS (SELECT 1 FROM support_ticket_items i WHERE i.ticket_id = t.id AND i.item_type = 'replacement')`;
            break;
        case 'my_open':
            params.push(user.user_id);
            extra += ` AND ${ACTIVE_TICKET_STATUSES} AND EXISTS (
                SELECT 1 FROM support_ticket_items i WHERE i.ticket_id = t.id AND i.assigned_to = $${params.length} AND i.status NOT IN ('resolved','closed','cancelled')
            )`;
            break;
        case 'my_resolved':
            params.push(user.user_id);
            extra += ` AND t.status <> 'cancelled' AND EXISTS (
                SELECT 1 FROM support_ticket_items i WHERE i.ticket_id = t.id AND i.assigned_to = $${params.length} AND i.status IN ('resolved','closed')
            ) AND COALESCE(t.closed_at, t.updated_at) >= NOW() - INTERVAL '30 days'`;
            break;
        case 'closed':
            extra += ` AND t.status = 'closed'`;
            break;
        case 'all':
            extra += ` AND t.status <> 'cancelled'`;
            break;
        case 'active':
        default:
            extra += ` AND ${ACTIVE_TICKET_STATUSES}`;
            break;
    }
    return extra;
};

const buildTicketListWhere = ({
    user,
    view = 'active',
    search = '',
    type = '',
    pickupType = '',
    closedDays = 30,
    assignedOnly = false,
    overdueHours,
    statusTab = '',
    priority = '',
    assignee = '',
    dateFrom = '',
    dateTo = ''
}) => {
    const params = [];
    let where = 'WHERE 1=1';
    where += applyViewFilter(view, params, user, overdueHours, { assignedOnly });

    if (statusTab === 'open') {
        where += ` AND ${ACTIVE_TICKET_STATUSES} AND t.status <> 'in_progress'`;
    } else if (statusTab === 'in_progress') {
        where += ` AND t.status = 'in_progress'`;
    }

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

    if (['repair', 'return'].includes(pickupType)) {
        params.push(pickupType);
        where += ` AND EXISTS (
            SELECT 1 FROM support_ticket_items i
            WHERE i.ticket_id = t.id AND i.item_type = 'pickup'
              AND ${pickupKindSql} = $${params.length}
        )`;
    }

    if (priority === 'high') {
        where += ` AND t.priority IN ('high', 'urgent')`;
    } else if (priority === 'normal') {
        where += ` AND (t.priority IS NULL OR t.priority = 'normal')`;
    }

    if (assignee === 'unassigned') {
        where += ` AND EXISTS (
            SELECT 1 FROM support_ticket_items i
            WHERE i.ticket_id = t.id AND i.assigned_to IS NULL AND i.status NOT IN ('resolved','closed')
        )`;
    } else if (assignee === 'me' && user?.user_id) {
        params.push(user.user_id);
        where += ` AND EXISTS (
            SELECT 1 FROM support_ticket_items i WHERE i.ticket_id = t.id AND i.assigned_to = $${params.length}
        )`;
    } else if (assignee && assignee !== 'all') {
        const uid = parseInt(assignee, 10);
        if (!Number.isNaN(uid)) {
            params.push(uid);
            where += ` AND EXISTS (
                SELECT 1 FROM support_ticket_items i WHERE i.ticket_id = t.id AND i.assigned_to = $${params.length}
            )`;
        }
    }

    if (dateFrom) {
        params.push(dateFrom);
        where += ` AND t.created_at >= $${params.length}::date`;
    }
    if (dateTo) {
        params.push(dateTo);
        where += ` AND t.created_at < ($${params.length}::date + INTERVAL '1 day')`;
    }

    if (view === 'closed' || view === 'my_resolved') {
        params.push(closedDays);
        where += ` AND COALESCE(t.closed_at, t.updated_at) >= NOW() - ($${params.length} || ' days')::interval`;
    }

    return { where, params };
};

const listTicketsEnriched = async ({
    user,
    view = 'active',
    search = '',
    type = '',
    pickupType = '',
    limit = 50,
    offset = 0,
    closedDays = 30,
    assignedOnly = false,
    statusTab = '',
    priority = '',
    assignee = '',
    dateFrom = '',
    dateTo = ''
}) => {
    const settings = await getSettings();
    const { where, params } = buildTicketListWhere({
        user,
        view,
        search,
        type,
        pickupType,
        closedDays,
        assignedOnly,
        overdueHours: settings.overdue_threshold_hours,
        statusTab,
        priority,
        assignee,
        dateFrom,
        dateTo
    });

    const countSql = `SELECT COUNT(*)::int AS total FROM support_tickets t ${where}`;
    const countRes = await pool.query(countSql, params);

    const listParams = [...params, limit, offset];
    const listSql = `
        ${ticketSelectCore(settings.overdue_threshold_hours)}
        ${where}
        ORDER BY t.id DESC
        LIMIT $${listParams.length - 1} OFFSET $${listParams.length}
    `;
    const listRes = await pool.query(listSql, listParams);
    const tickets = await attachItems(listRes.rows);

    return {
        total: countRes.rows[0]?.total || 0,
        limit,
        offset,
        settings,
        tickets
    };
};

const countTicketsByType = async (filters) => {
    const settings = await getSettings();
    const { where, params } = buildTicketListWhere({
        ...filters,
        type: '',
        overdueHours: settings.overdue_threshold_hours
    });
    const sql = `
        SELECT
            COUNT(*)::int AS all,
            COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM support_ticket_items i
                WHERE i.ticket_id = t.id AND i.item_type = 'complaint'
            ))::int AS complaint,
            COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM support_ticket_items i
                WHERE i.ticket_id = t.id AND i.item_type = 'pickup'
            ))::int AS pickup,
            COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM support_ticket_items i
                WHERE i.ticket_id = t.id AND i.item_type = 'pickup'
                  AND ${pickupKindSql} = 'repair'
            ))::int AS repair_pickup,
            COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM support_ticket_items i
                WHERE i.ticket_id = t.id AND i.item_type = 'pickup'
                  AND ${pickupKindSql} = 'return'
            ))::int AS return_pickup,
            COUNT(*) FILTER (WHERE EXISTS (
                SELECT 1 FROM support_ticket_items i
                WHERE i.ticket_id = t.id AND i.item_type = 'replacement'
            ))::int AS replacement
        FROM support_tickets t
        ${where}
    `;
    const { rows } = await pool.query(sql, params);
    return rows[0] || { all: 0, complaint: 0, pickup: 0, repair_pickup: 0, return_pickup: 0, replacement: 0 };
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
            (SELECT COUNT(*)::int FROM support_tickets t WHERE ${ACTIVE_TICKET_STATUSES} AND ${techTicketExists}) AS open_total,
            (SELECT COUNT(*)::int FROM support_tickets t WHERE ${ACTIVE_TICKET_STATUSES} AND ${techTicketExists}
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
            (SELECT COUNT(*)::int FROM support_tickets t WHERE ${ACTIVE_TICKET_STATUSES} AND ${techTicketExists}
                AND EXISTS (SELECT 1 FROM support_ticket_items i WHERE i.ticket_id = t.id AND i.assigned_to IS NULL AND i.status NOT IN ('resolved','closed','cancelled'))) AS unassigned_tickets
        `,
        [oh]
    );

    return { ...(q.rows[0] || {}), settings };
};

// Daily Support Summary KPI cards.
// Filters: dateFrom / dateTo (defaults to today), assignee (user_id), team (team_id).
// The assignee/team filters are applied on the item's assigned technician.
const dailySupportSummary = async ({ dateFrom = '', dateTo = '', assignee = '', teamIds = null } = {}) => {
    const today = new Date().toISOString().slice(0, 10);
    const from = dateFrom || today;
    const to = dateTo || dateFrom || today;
    const assigneeId = assignee ? parseInt(assignee, 10) : null;
    const teamList = Array.isArray(teamIds) && teamIds.length ? teamIds.map(Number).filter((n) => !Number.isNaN(n)) : null;

    // $1 from, $2 to, $3 assignee, $4 team ids (reused across every sub-count).
    const params = [from, to, Number.isNaN(assigneeId) ? null : assigneeId, teamList && teamList.length ? teamList : null];

    // Restrict to the selected technician / team (NULL param => no restriction).
    const scope = `
        ($3::int IS NULL OR i.assigned_to = $3)
        AND ($4::int[] IS NULL OR i.assigned_to IN (SELECT u2.user_id FROM users u2 WHERE u2.team_id = ANY($4::int[])))
    `;
    const inRange = (col) => `${col} >= $1::date AND ${col} < ($2::date + INTERVAL '1 day')`;
    const openStatus = `i.status NOT IN ('resolved','closed','cancelled')`;
    const doneStatus = `i.status IN ('resolved','closed')`;

    const { rows } = await pool.query(
        `
        SELECT
            -- Daily Pickup
            COUNT(*) FILTER (WHERE i.item_type = 'pickup' AND ${openStatus}
                AND i.pickup_completed_at IS NULL AND i.pickup_scheduled_at IS NULL
                AND ${inRange('i.created_at')} AND ${scope})::int AS pending_pickup,
            COUNT(*) FILTER (WHERE i.item_type = 'pickup' AND ${openStatus}
                AND i.pickup_completed_at IS NULL AND i.pickup_scheduled_at IS NOT NULL
                AND ${inRange('i.created_at')} AND ${scope})::int AS followup_pickup,

            -- Daily Complaints
            COUNT(*) FILTER (WHERE i.item_type = 'complaint' AND ${openStatus}
                AND ${inRange('i.created_at')} AND ${scope})::int AS pending_complaints,
            COUNT(*) FILTER (WHERE i.item_type = 'complaint' AND ${doneStatus}
                AND i.resolved_at IS NOT NULL AND ${inRange('i.resolved_at')} AND ${scope})::int AS resolved_complaints,

            -- Daily Replacements
            COUNT(*) FILTER (WHERE i.item_type = 'replacement'
                AND COALESCE(i.pickup_completed_at, i.picked_up_at) IS NOT NULL
                AND ${inRange('COALESCE(i.pickup_completed_at, i.picked_up_at)')} AND ${scope})::int AS replacement_pickup_completed,
            COUNT(*) FILTER (WHERE i.item_type = 'replacement' AND ${doneStatus}
                AND i.resolved_at IS NOT NULL AND ${inRange('i.resolved_at')} AND ${scope})::int AS replacement_completed,

            -- Daily Returned Laptops (units received back at the warehouse in range)
            COUNT(*) FILTER (WHERE i.warehouse_received_at IS NOT NULL
                AND ${inRange('i.warehouse_received_at')} AND ${scope})::int AS returned_total,
            COUNT(*) FILTER (WHERE i.item_type = 'pickup' AND i.warehouse_received_at IS NOT NULL
                AND ${inRange('i.warehouse_received_at')} AND ${scope})::int AS returned_pickup,
            COUNT(*) FILTER (WHERE i.item_type = 'replacement' AND i.warehouse_received_at IS NOT NULL
                AND ${inRange('i.warehouse_received_at')} AND ${scope})::int AS returned_replacement,
            COUNT(*) FILTER (WHERE i.item_type = 'complaint' AND i.warehouse_received_at IS NOT NULL
                AND ${inRange('i.warehouse_received_at')} AND ${scope})::int AS returned_complaint
        FROM support_ticket_items i
        `,
        params
    );

    const r = rows[0] || {};
    return {
        range: { from, to },
        pickup: {
            pending: r.pending_pickup || 0,
            followup: r.followup_pickup || 0,
        },
        complaints: {
            pending: r.pending_complaints || 0,
            resolved: r.resolved_complaints || 0,
        },
        replacements: {
            pickup_completed: r.replacement_pickup_completed || 0,
            completed: r.replacement_completed || 0,
        },
        returned: {
            total: r.returned_total || 0,
            pickup: r.returned_pickup || 0,
            replacement: r.returned_replacement || 0,
            complaint: r.returned_complaint || 0,
        },
    };
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
                    WHERE i.assigned_to = $1 AND t.status NOT IN ('closed', 'cancelled') AND i.status NOT IN ('resolved','closed','cancelled')) AS my_open,
                (SELECT COUNT(DISTINCT t.id)::int FROM support_tickets t
                    JOIN support_ticket_items i ON i.ticket_id = t.id
                    WHERE i.assigned_to = $1 AND t.status = 'closed'
                    AND COALESCE(t.closed_at, t.updated_at) >= NOW() - INTERVAL '30 days') AS my_resolved
            `,
            [user.user_id]
        );
        return rows[0] || {};
    }
    let rows;
    try {
        ({ rows } = await pool.query(
            `
            SELECT
                (SELECT COUNT(*)::int FROM support_tickets WHERE status NOT IN ('closed', 'cancelled')) AS open_tickets,
                (SELECT COUNT(*)::int FROM support_tickets t WHERE ${ACTIVE_TICKET_STATUSES}
                    AND EXTRACT(EPOCH FROM (NOW() - ${activityAtSql})) / 3600.0 >= $1) AS overdue_tickets,
                (SELECT COUNT(*)::int FROM support_tickets t WHERE ${ACTIVE_TICKET_STATUSES}
                    AND EXISTS (SELECT 1 FROM support_ticket_items i WHERE i.ticket_id = t.id AND i.assigned_to IS NULL AND i.status NOT IN ('resolved','closed','cancelled'))) AS pending_assign,
                (SELECT COUNT(*)::int FROM support_part_requests spr
                    WHERE spr.status IN ('pending','return_requested')
                       OR (spr.reassign_requested_at IS NOT NULL AND spr.status IN ('issued','return_requested'))
                ) AS support_part_requests
            `,
            [oh]
        ));
    } catch {
        ({ rows } = await pool.query(
            `
            SELECT
                (SELECT COUNT(*)::int FROM support_tickets WHERE status NOT IN ('closed', 'cancelled')) AS open_tickets,
                (SELECT COUNT(*)::int FROM support_tickets t WHERE ${ACTIVE_TICKET_STATUSES}
                    AND EXTRACT(EPOCH FROM (NOW() - ${activityAtSql})) / 3600.0 >= $1) AS overdue_tickets,
                (SELECT COUNT(*)::int FROM support_tickets t WHERE ${ACTIVE_TICKET_STATUSES}
                    AND EXISTS (SELECT 1 FROM support_ticket_items i WHERE i.ticket_id = t.id AND i.assigned_to IS NULL AND i.status NOT IN ('resolved','closed','cancelled'))) AS pending_assign,
                0::int AS support_part_requests
            `,
            [oh]
        ));
    }
    return rows[0] || {};
};

module.exports = {
    getSettings,
    buildTicketListWhere,
    listTicketsEnriched,
    countTicketsByType,
    dashboardSummary,
    dailySupportSummary,
    navBadges
};
