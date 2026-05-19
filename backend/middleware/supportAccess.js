const SUPPORT_ROLES = ['admin', 'support_lead', 'support_tech'];

const isSupportUser = (user) => user && SUPPORT_ROLES.includes(user.role);

const isSupportLead = (user) => user && (user.role === 'admin' || user.role === 'support_lead');

const isSupportTechnician = (user) => user && user.role === 'support_tech';

const hasCustomerInventoryAccess = (user) => {
    if (!user) return false;
    if (['admin', 'manager', 'floor_manager', 'support_lead'].includes(user.role)) return true;
    const perms = Array.isArray(user.permissions) ? user.permissions : [];
    return perms.includes('customer_inventory_access');
};

const requireSupportAccess = (req, res, next) => {
    if (!req.user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!isSupportUser(req.user)) {
        return res.status(403).json({ success: false, message: 'Support access required' });
    }
    return next();
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
