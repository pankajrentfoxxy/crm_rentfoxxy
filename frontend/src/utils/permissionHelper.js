import { normalizeAction } from '../constants/sections';

/** Legacy users.permissions[] strings → section access (backward compat) */
const LEGACY_STRING_TO_SECTIONS = {
  inventory_read: ['inventory', 'inventory_management'],
  inventory_write: ['inventory', 'inventory_management'],
  inventory_access: ['inventory', 'inventory_management'],
  inventory_management_access: ['inventory_management'],
  reports_access: ['reports', 'reports_access', 'manager_dashboard'],
  sales_access: ['leads', 'sales_orders', 'follow_ups', 'lead_orders', 'customers'],
  orders_access: ['lead_orders', 'sales_orders'],
  parts_access: ['parts', 'parts_inventory'],
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
    'lead_orders', 'customers', 'manager_dashboard', 'reports', 'parts', 'parts_inventory',
    'procurement', 'vendor_management', 'warehouse', 'qc_management',
    'inventory_management', 'dispatch', 'support_tickets', 'customer_inventory',
    'teams', 'roles', 'role_permissions', 'user_permissions', 'users',
    'analytics_dashboard', 'reports_export', 'reports_access',
  ],
  manager: [
    'dashboard', 'inventory', 'tickets', 'leads', 'sales_orders', 'follow_ups',
    'lead_orders', 'customers', 'manager_dashboard', 'reports', 'reports_access', 'analytics_dashboard', 'reports_export', 'parts', 'parts_inventory',
    'procurement', 'vendor_management', 'warehouse', 'qc_management',
    'inventory_management', 'dispatch', 'support_tickets', 'customer_inventory', 'teams',
    'users', 'role_permissions', 'user_permissions',
  ],
  sales: ['dashboard', 'leads', 'sales_orders', 'follow_ups', 'lead_orders', 'customers', 'analytics_dashboard'],
  accounts: ['customer_billing', 'vendor_billing_mgmt', 'credit_notes', 'debit_notes', 'reports', 'reports_export'],
  floor_manager: [
    'dashboard', 'inventory', 'tickets', 'reports', 'reports_access', 'parts', 'parts_inventory', 'qc_management',
    'inventory_management', 'dispatch', 'customer_inventory',
  ],
  procurement: ['procurement', 'vendor_management'],
  qc: ['qc_management'],
  warehouse: ['warehouse', 'parts_inventory', 'inventory_management'],
  dispatch: ['dispatch'],
  support_lead: ['support_tickets', 'customer_inventory'],
  support_tech: ['support_tickets', 'customer_inventory'],
  team_member: ['dashboard', 'tickets'],
  team_lead: ['dashboard', 'tickets'],
  technician: ['tickets', 'inventory', 'customers', 'parts_inventory'],
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

/** RBAC section aliases — menu may use reports_access while DB stores reports */
const SECTION_ALIASES = {
  reports_access: ['reports_access', 'reports'],
  reports: ['reports', 'reports_access'],
};

function sectionsToCheck(section) {
  return SECTION_ALIASES[section] || [section];
}

export function resolveEffectivePermission(effectivePermissions, section, action) {
  const actionKey = normalizeAction(action);
  if (!actionKey || !section) return false;
  return sectionsToCheck(section).some(
    (key) => effectivePermissions?.[key]?.[actionKey] === true
  );
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
