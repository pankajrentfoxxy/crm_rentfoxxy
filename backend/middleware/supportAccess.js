const pool = require('../config/db');
const { hasPermission } = require('../services/permissionService');
const { userHasRoleOrSection } = require('./roleOrSection');

const SUPPORT_ROLES = ['admin', 'manager', 'super_admin', 'support_lead', 'support_tech'];

/** Support users need read-only parts catalog when logging parts on tickets. */
const SUPPORT_PARTS_CATALOG_SECTIONS = [
  'support_tickets',
  'support_part_requests',
  'support_part_challan',
  'support_technician',
];

const isSupportUser = (user) => user && SUPPORT_ROLES.includes(user.role);

const SUPPORT_LEAD_ROLES = ['super_admin', 'admin', 'manager', 'support_lead'];
const SUPPORT_TICKET_ASSIGNEE_PERMISSION = 'support_ticket_assignee';

const isSupportLead = (user) =>
  Boolean(user && SUPPORT_LEAD_ROLES.includes(user.role));

const canCloseSupportTicket = (user) =>
  user && (isSupportLead(user) || user.role === 'warehouse');

/** Admin / super_admin / support_lead only — ERP migration ticket cancellation. */
const canCancelSupportTicket = (user) =>
  Boolean(user && ['super_admin', 'admin', 'support_lead'].includes(user.role));

const isSupportTechnician = (user) => user && user.role === 'support_tech';

const hasSupportTicketAssigneeGrant = (user) => {
  const perms = Array.isArray(user?.permissions) ? user.permissions : [];
  return perms.includes(SUPPORT_TICKET_ASSIGNEE_PERMISSION);
};

/** Warehouse / internal lead: same ticket tools as support lead, but only on assigned tickets. */
const canManageAsTicketLead = (user) =>
  Boolean(user && (isSupportLead(user) || hasSupportTicketAssigneeGrant(user)));

/** Internal viewer (not a field technician) who only sees tickets assigned to them. */
const isAssignedTicketsOnly = (user) =>
  Boolean(user && !isSupportLead(user) && (isSupportTechnician(user) || hasSupportTicketAssigneeGrant(user)));

/*
 * CT1 (27 Sep 2026): the role lists above also accept a Roles & Permissions
 * grant. Lead-level actions (create / assign / cancel / close / manage a ticket)
 * need support_tickets DELETE — support_tickets EDIT is held by agent-level
 * roles (support_agent), so it must not make someone a lead. These async
 * variants never throw: a permission lookup failure denies (fails closed).
 */
const SUPPORT_LEAD_SECTION = 'support_tickets';
const SUPPORT_LEAD_ACTION = 'delete';

function permCache(req) {
  if (!req) return undefined;
  if (!req.permissionCache) req.permissionCache = {};
  return req.permissionCache;
}

async function grantSafe(user, roles, section, action, cache) {
  try {
    return await userHasRoleOrSection(user, roles, section, action, cache);
  } catch (err) {
    console.error('supportAccess grant check failed:', err.message);
    return false;
  }
}

/** isSupportLead OR support_tickets delete grant. */
const isSupportLeadOrGranted = (user, cache) =>
  grantSafe(user, SUPPORT_LEAD_ROLES, SUPPORT_LEAD_SECTION, SUPPORT_LEAD_ACTION, cache);

/** canManageAsTicketLead OR support_tickets delete grant. */
const canManageAsTicketLeadOrGranted = async (user, cache) =>
  canManageAsTicketLead(user) || isSupportLeadOrGranted(user, cache);

/** canCloseSupportTicket OR support_tickets delete grant. */
const canCloseSupportTicketOrGranted = async (user, cache) =>
  Boolean(canCloseSupportTicket(user)) || isSupportLeadOrGranted(user, cache);

/** canCancelSupportTicket OR support_tickets delete grant. */
const canCancelSupportTicketOrGranted = (user, cache) =>
  grantSafe(user, ['super_admin', 'admin', 'support_lead'], SUPPORT_LEAD_SECTION, SUPPORT_LEAD_ACTION, cache);

async function resolveTicketIdFromRequest(req) {
  const ticketId = parseInt(req.params.ticketId, 10);
  if (Number.isFinite(ticketId) && ticketId > 0) return ticketId;

  const itemId = parseInt(req.params.itemId, 10);
  if (Number.isFinite(itemId) && itemId > 0) {
    const r = await pool.query('SELECT ticket_id FROM support_ticket_items WHERE id = $1', [itemId]);
    return r.rows[0]?.ticket_id || null;
  }

  const orderId = parseInt(req.params.orderId, 10);
  if (Number.isFinite(orderId) && orderId > 0) {
    const r = await pool.query('SELECT ticket_id FROM support_replacement_orders WHERE id = $1', [orderId]);
    return r.rows[0]?.ticket_id || null;
  }

  const sdcNumber = req.params.sdcNumber;
  if (sdcNumber) {
    const r = await pool.query(
      'SELECT ticket_id FROM support_ticket_items WHERE service_dc_number = $1 LIMIT 1',
      [sdcNumber]
    );
    return r.rows[0]?.ticket_id || null;
  }
  return null;
}

async function isTicketAssignedToUser(ticketId, userId) {
  const r = await pool.query(
    `SELECT 1 FROM support_ticket_items
      WHERE ticket_id = $1 AND assigned_to = $2
      LIMIT 1`,
    [ticketId, userId]
  );
  return r.rows.length > 0;
}

/** Real support leads always; warehouse lead only when this ticket is assigned to them. */
const requireTicketLead = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  if (await isSupportLeadOrGranted(req.user, permCache(req))) return next();
  if (!hasSupportTicketAssigneeGrant(req.user)) {
    return res.status(403).json({ success: false, message: 'Support lead or assigned warehouse lead required' });
  }
  try {
    const ticketId = await resolveTicketIdFromRequest(req);
    if (!ticketId) {
      return res.status(403).json({ success: false, message: 'You can only manage tickets assigned to you' });
    }
    const ok = await isTicketAssignedToUser(ticketId, req.user.user_id);
    if (!ok) {
      return res.status(403).json({ success: false, message: 'You can only manage tickets assigned to you' });
    }
    return next();
  } catch (err) {
    console.error('requireTicketLead:', err);
    return res.status(500).json({ success: false, message: 'Server error checking ticket access' });
  }
};

const hasCustomerInventoryAccess = (user) => {
    if (!user) return false;
    if (['admin', 'manager', 'floor_manager', 'support_lead'].includes(user.role)) return true;
    const perms = Array.isArray(user.permissions) ? user.permissions : [];
    return perms.includes('customer_inventory_access');
};

/** Gate Support API routes — permission matrix is source of truth. */
const requireSupportAccess = async (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (req.user.role === 'super_admin') {
        return next();
    }

    if (!req.permissionCache) {
        req.permissionCache = {};
    }

    try {
        const live = await pool.query(
            'SELECT role, permissions FROM users WHERE user_id = $1',
            [req.user.user_id]
        );
        if (live.rows[0]) {
            req.user.role = live.rows[0].role;
            req.user.permissions = Array.isArray(live.rows[0].permissions)
                ? live.rows[0].permissions
                : [];
        }

        const allowed = await hasPermission(
            req.user.user_id,
            req.user.role,
            'support_tickets',
            'can_view',
            req.permissionCache
        );
        if (allowed) return next();
        return res.status(403).json({ success: false, message: 'Support access required' });
    } catch (err) {
        console.error('requireSupportAccess:', err);
        return res.status(500).json({ success: false, message: 'Server error checking permissions' });
    }
};

const requireSupportLead = async (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!(await isSupportLeadOrGranted(req.user, permCache(req)))) {
        return res.status(403).json({ success: false, message: 'Support lead or admin required' });
    }
    return next();
};

const requireSupportTicketClose = async (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!(await canCloseSupportTicketOrGranted(req.user, permCache(req)))) {
        return res.status(403).json({ success: false, message: 'Not allowed to close support tickets' });
    }
    return next();
};

const requireSupportTicketCancel = async (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!(await canCancelSupportTicketOrGranted(req.user, permCache(req)))) {
        return res.status(403).json({ success: false, message: 'Not allowed to cancel support tickets' });
    }
    return next();
};

async function resolveSupportAssigneeId(userId) {
    const id = parseInt(userId, 10);
    if (!Number.isFinite(id) || id <= 0) return null;
    const { rows } = await pool.query(
        `SELECT user_id FROM users
          WHERE user_id = $1 AND active = true
            AND (
              role IN ('support_tech', 'support_lead')
              OR 'support_ticket_assignee' = ANY(COALESCE(permissions, ARRAY[]::text[]))
            )`,
        [id]
    );
    return rows[0]?.user_id || null;
}

module.exports = {
    SUPPORT_ROLES,
    SUPPORT_PARTS_CATALOG_SECTIONS,
    isSupportUser,
    isSupportLead,
    canCloseSupportTicket,
    canCancelSupportTicket,
    isSupportTechnician,
    isAssignedTicketsOnly,
    hasSupportTicketAssigneeGrant,
    canManageAsTicketLead,
    SUPPORT_TICKET_ASSIGNEE_PERMISSION,
    hasCustomerInventoryAccess,
    requireSupportAccess,
    requireSupportLead,
    requireTicketLead,
    isTicketAssignedToUser,
    requireSupportTicketClose,
    requireSupportTicketCancel,
    resolveSupportAssigneeId,
    permCache,
    isSupportLeadOrGranted,
    canManageAsTicketLeadOrGranted,
    canCloseSupportTicketOrGranted,
    canCancelSupportTicketOrGranted,
};
