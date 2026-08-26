const pool = require('../config/db');
const { hasPermission } = require('../services/permissionService');

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
  if (isSupportLead(req.user)) return next();
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

const requireSupportLead = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!isSupportLead(req.user)) {
        return res.status(403).json({ success: false, message: 'Support lead or admin required' });
    }
    return next();
};

const requireSupportTicketClose = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!canCloseSupportTicket(req.user)) {
        return res.status(403).json({ success: false, message: 'Not allowed to close support tickets' });
    }
    return next();
};

const requireSupportTicketCancel = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!canCancelSupportTicket(req.user)) {
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
};
