// Authorization for Support is driven by the role_permissions matrix at the
// route boundary (ProtectedRoute section="support_tickets"). These role lists
// only shape in-module UX (lead vs technician views). super_admin/manager are
// included so admins are never bounced out of a module the matrix grants them.
import { canViewSection } from './permissionHelper';
export const SUPPORT_ROLES = ['super_admin', 'admin', 'manager', 'support_lead', 'support_tech'];

/** Sales / delivery sections a support_tech may open outside /support when granted. */
export const SUPPORT_TECH_DELIVERY_SECTIONS = [
  'technician_bucket',
  'delivery_challans',
  'delivery_register_management',
  'return_dc',
  'sales_quotations',
  'sales_orders_doc',
];

export const isSupportUser = (user) => user && SUPPORT_ROLES.includes(user.role);

/** Matrix-first: any role with support_tickets view may open the Support module. */
export function canAccessSupportModule(user, effectivePermissions) {
  return canViewSection(user, effectivePermissions, 'support_tickets');
}

export const isSupportTechnician = (user) => user?.role === 'support_tech';

export const isSupportLead = (user) =>
  ['super_admin', 'admin', 'manager', 'support_lead'].includes(user?.role);

/** Support lead/admin/manager or warehouse staff may close tickets. */
export const canCloseSupportTicket = (user) =>
  isSupportLead(user) || user?.role === 'warehouse';

export const canAccessCustomerInventory = (user) => {
    if (!user) return false;
    if (['admin', 'manager', 'floor_manager', 'support_lead'].includes(user.role)) return true;
    const perms = Array.isArray(user.permissions) ? user.permissions : [];
    return perms.includes('customer_inventory_access');
};

/** True when a support_tech may leave the /support shell for this path (permission-aware). */
export function supportTechnicianMayAccessPath(pathname, canView) {
  if (!pathname) return false;
  if (pathname.startsWith('/support')) return true;
  if (pathname.startsWith('/customer-inventory') && canView('customer_inventory')) return true;
  if (pathname.startsWith('/sales-pipeline')) {
    return SUPPORT_TECH_DELIVERY_SECTIONS.some((s) => canView(s));
  }
  if (pathname.startsWith('/delivery-register-management')) {
    return canView('delivery_register_management');
  }
  return false;
}

export const postLoginPath = () => '/';
