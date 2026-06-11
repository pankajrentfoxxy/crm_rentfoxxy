import { normalizeAction } from '../constants/sections';

/** Legacy users.permissions[] strings → section access (backward compat) */
const LEGACY_STRING_TO_SECTIONS = {
  inventory_read: ['inventory', 'inventory_management'],
  inventory_write: ['inventory', 'inventory_management'],
  inventory_access: ['inventory', 'inventory_management'],
  inventory_management_access: ['inventory_management'],
  reports_access: ['reports', 'manager_dashboard'],
  sales_access: ['leads', 'sales_orders', 'follow_ups', 'lead_orders', 'customers'],
  orders_access: ['lead_orders', 'sales_orders'],
  parts_access: ['parts'],
  procurement_access: ['procurement'],
  vendor_management_access: ['vendor_management'],
  warehouse_access: ['warehouse'],
  qc_access: ['qc_management'],
  dispatch_access: ['dispatch'],
  support_access: ['support_tickets'],
  customer_inventory_access: ['customer_inventory'],
};

/** Legacy role → default section view access when RBAC matrix not loaded */
const LEGACY_ROLE_SECTIONS = {
  super_admin: null,
  admin: [
    'dashboard', 'inventory', 'tickets', 'leads', 'sales_orders', 'follow_ups',
    'lead_orders', 'customers', 'manager_dashboard', 'reports', 'parts',
    'procurement', 'vendor_management', 'warehouse', 'qc_management',
    'inventory_management', 'dispatch', 'support_tickets', 'customer_inventory',
    'teams', 'roles', 'role_permissions', 'user_permissions',
    'analytics_dashboard', 'reports_export',
  ],
  manager: [
    'dashboard', 'inventory', 'tickets', 'leads', 'sales_orders', 'follow_ups',
    'lead_orders', 'customers', 'manager_dashboard', 'reports', 'analytics_dashboard', 'reports_export', 'parts',
    'procurement', 'vendor_management', 'warehouse', 'qc_management',
    'inventory_management', 'dispatch', 'support_tickets', 'customer_inventory', 'teams',
  ],
  sales: ['dashboard', 'leads', 'sales_orders', 'follow_ups', 'lead_orders', 'customers', 'analytics_dashboard'],
  accounts: ['customer_billing', 'vendor_billing_mgmt', 'credit_notes', 'debit_notes', 'reports', 'reports_export'],
  floor_manager: [
    'dashboard', 'inventory', 'tickets', 'reports', 'parts', 'qc_management',
    'inventory_management', 'dispatch', 'customer_inventory',
  ],
  procurement: ['procurement', 'vendor_management'],
  qc: ['qc_management'],
  warehouse: ['warehouse'],
  dispatch: ['dispatch'],
  support_lead: ['support_tickets', 'customer_inventory'],
  support_tech: ['support_tickets', 'customer_inventory'],
  team_member: ['dashboard', 'tickets'],
  team_lead: ['dashboard', 'tickets'],
  technician: ['tickets', 'inventory', 'customers'],
  vendor: ['vendor_management'],
  customer: ['tickets', 'customers'],
};

function legacyStringGrantsView(user, section) {
  const perms = Array.isArray(user?.permissions) ? user.permissions : [];
  for (const [legacyKey, sections] of Object.entries(LEGACY_STRING_TO_SECTIONS)) {
    if (perms.includes(legacyKey) && sections.includes(section)) return true;
  }
  return false;
}

function legacyRoleGrants(user, section, actionKey) {
  if (user?.role === 'super_admin') return true;
  const sections = LEGACY_ROLE_SECTIONS[user?.role];
  if (!sections) return false;
  if (actionKey === 'can_view') return sections.includes(section);
  if (['can_create', 'can_edit', 'can_delete'].includes(actionKey)) {
    return ['admin', 'manager'].includes(user?.role) && sections.includes(section);
  }
  return false;
}

export function resolveEffectivePermission(effectivePermissions, section, action) {
  const actionKey = normalizeAction(action);
  if (!actionKey || !section) return false;
  return effectivePermissions?.[section]?.[actionKey] === true;
}

export function hasPermission(user, effectivePermissions, section, action) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;

  const actionKey = normalizeAction(action);
  if (!actionKey) return false;

  if (effectivePermissions && Object.keys(effectivePermissions).length > 0) {
    return resolveEffectivePermission(effectivePermissions, section, actionKey);
  }

  if (legacyStringGrantsView(user, section) && actionKey === 'can_view') return true;
  return legacyRoleGrants(user, section, actionKey);
}

export function canViewSection(user, effectivePermissions, section) {
  return hasPermission(user, effectivePermissions, section, 'view');
}
