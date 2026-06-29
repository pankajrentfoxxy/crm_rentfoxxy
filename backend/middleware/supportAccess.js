const { hasPermission } = require('../services/permissionService');

const SUPPORT_ROLES = ['admin', 'manager', 'super_admin', 'support_lead', 'support_tech'];

const isSupportUser = (user) => user && SUPPORT_ROLES.includes(user.role);

const isSupportLead = (user) =>
  user && ['super_admin', 'admin', 'manager', 'support_lead'].includes(user.role);

const isSupportTechnician = (user) => user && user.role === 'support_tech';

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

module.exports = {
    SUPPORT_ROLES,
    isSupportUser,
    isSupportLead,
    isSupportTechnician,
    hasCustomerInventoryAccess,
    requireSupportAccess,
    requireSupportLead
};
