// Authorization for Support is driven by the role_permissions matrix at the
// route boundary (ProtectedRoute section="support_tickets"). These role lists
// only shape in-module UX (lead vs technician views). super_admin/manager are
// included so admins are never bounced out of a module the matrix grants them.
export const SUPPORT_ROLES = ['super_admin', 'admin', 'manager', 'support_lead', 'support_tech'];

export const isSupportUser = (user) => user && SUPPORT_ROLES.includes(user.role);

export const isSupportTechnician = (user) => user?.role === 'support_tech';

export const isSupportLead = (user) =>
  ['super_admin', 'admin', 'manager', 'support_lead'].includes(user?.role);

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
