export const SUPPORT_ROLES = ['admin', 'support_lead', 'support_tech'];

export const isSupportUser = (user) => user && SUPPORT_ROLES.includes(user.role);

export const isSupportTechnician = (user) => user?.role === 'support_tech';

export const isSupportLead = (user) => user?.role === 'admin' || user?.role === 'support_lead';

export const canAccessCustomerInventory = (user) => {
    if (!user) return false;
    if (['admin', 'manager', 'floor_manager', 'support_lead'].includes(user.role)) return true;
    const perms = Array.isArray(user.permissions) ? user.permissions : [];
    return perms.includes('customer_inventory_access');
};

export const postLoginPath = (user) => {
    if (isSupportTechnician(user)) return '/support/my-tickets';
    return '/dashboard';
};
