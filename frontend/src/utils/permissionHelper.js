import { normalizeAction } from '../constants/sections';
import {
  childSectionsForParent,
  isChildModuleSection,
  sectionsToCheck,
} from '../constants/sectionHierarchy';

/** Legacy users.permissions[] strings → section access (backward compat) */
const LEGACY_STRING_TO_SECTIONS = {
  inventory_read: ['inventory', 'inventory_management'],
  inventory_write: ['inventory', 'inventory_management'],
  inventory_access: ['inventory', 'inventory_management'],
  inventory_management_access: ['inventory_management'],
  reports_access: ['reports', 'reports_access', 'manager_dashboard'],
  sales_access: ['leads', 'sales_orders', 'follow_ups', 'lead_orders', 'customers'],
  orders_access: ['lead_orders', 'sales_orders'],
  parts_access: ['parts', 'parts_dashboard', 'parts_inventory', 'parts_approval', 'parts_history', 'parts_procurement', 'part_vendor_repair', 'parts_discarded', 'scrap_challans'],
  procurement_access: ['procurement', 'parts_procurement'],
  vendor_management_access: ['vendor_management', 'vendor_repair_dc'],
  warehouse_access: ['warehouse'],
  qc_access: ['qc_management'],
  dispatch_access: ['dispatch'],
  support_access: ['support_tickets', 'support_part_challan', 'support_part_requests'],
  customer_inventory_access: ['customer_inventory'],
};

/** Legacy role → default section view access when RBAC matrix not loaded */
const LEGACY_ROLE_SECTIONS = {
  super_admin: null,
  admin: [
    'dashboard', 'inventory', 'tickets', 'leads', 'sales_orders', 'follow_ups',
    'lead_orders', 'customers', 'manager_dashboard', 'reports', 'parts', 'parts_dashboard', 'parts_inventory',
    'parts_approval', 'parts_history', 'parts_procurement', 'part_vendor_repair', 'parts_discarded', 'scrap_challans',
    'procurement', 'vendor_management', 'vendor_repair_dc', 'warehouse', 'qc_management',
    'inventory_management', 'dispatch', 'support_tickets', 'support_part_challan', 'support_part_requests', 'customer_inventory',
    'diagnosis_failed',
    'teams', 'roles', 'role_permissions', 'user_permissions', 'users',
    'analytics_dashboard', 'reports_export', 'reports_access',
  ],
  manager: [
    'dashboard', 'inventory', 'tickets', 'leads', 'sales_orders', 'follow_ups',
    'lead_orders', 'customers', 'manager_dashboard', 'reports', 'reports_access', 'analytics_dashboard', 'reports_export',
    'parts', 'parts_dashboard', 'parts_inventory', 'parts_approval', 'parts_history', 'parts_procurement', 'part_vendor_repair',
    'parts_discarded', 'scrap_challans',
    'procurement', 'vendor_management', 'vendor_repair_dc', 'warehouse', 'qc_management',
    'inventory_management', 'dispatch', 'support_tickets', 'support_part_challan', 'support_part_requests', 'customer_inventory',
    'diagnosis_failed', 'teams',
    'users', 'role_permissions', 'user_permissions',
  ],
  sales: ['dashboard', 'leads', 'sales_orders', 'follow_ups', 'lead_orders', 'customers', 'analytics_dashboard'],
  accounts: ['customer_billing', 'vendor_billing_mgmt', 'credit_notes', 'debit_notes', 'reports', 'reports_export'],
  floor_manager: [
    'dashboard', 'inventory', 'tickets', 'reports', 'reports_access', 'parts', 'parts_dashboard', 'parts_inventory',
    'parts_approval', 'part_vendor_repair', 'qc_management', 'vendor_repair_dc',
    'inventory_management', 'dispatch', 'customer_inventory', 'diagnosis_failed',
  ],
  procurement: ['procurement', 'vendor_management', 'vendor_repair_dc', 'parts_procurement', 'parts_inventory', 'part_vendor_repair'],
  qc: ['qc_management'],
  warehouse: [
    'warehouse', 'parts_dashboard', 'parts_inventory', 'parts_approval', 'parts_history', 'part_vendor_repair',
    'parts_discarded', 'scrap_challans', 'inventory_management', 'support_part_challan', 'vendor_repair_dc',
    'diagnosis_failed',
  ],
  dispatch: ['dispatch'],
  support_lead: ['support_tickets', 'customer_inventory', 'support_part_requests', 'support_part_challan', 'diagnosis_failed'],
  support_tech: ['support_tickets', 'customer_inventory', 'support_part_requests'],
  team_member: ['dashboard', 'tickets'],
  team_lead: ['dashboard', 'tickets'],
  technician: ['tickets', 'inventory', 'customers', 'parts_inventory'],
  vendor: ['vendor_management'],
  customer: ['tickets', 'customers'],
};

function legacyStringGrantsView(user, section) {
  const perms = Array.isArray(user?.permissions) ? user.permissions : [];
  for (const [legacyKey, sections] of Object.entries(LEGACY_STRING_TO_SECTIONS)) {
    if (perms.includes(legacyKey) && sectionsToCheck(section).some((s) => sections.includes(s))) {
      return true;
    }
  }
  return false;
}

function legacyRoleGrants(user, section, actionKey) {
  if (user?.role === 'super_admin') return true;
  const sections = LEGACY_ROLE_SECTIONS[user?.role];
  if (!sections) return false;
  const keys = sectionsToCheck(section);
  if (actionKey === 'can_view') return keys.some((key) => sections.includes(key));
  if (['can_create', 'can_edit', 'can_delete'].includes(actionKey)) {
    return ['admin', 'manager'].includes(user?.role) && keys.some((key) => sections.includes(key));
  }
  return false;
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
    // Child modules require an explicit grant on the child (or alias) section.
    if (isChildModuleSection(section)) {
      return resolveEffectivePermission(effectivePermissions, section, actionKey);
    }

    return resolveEffectivePermission(effectivePermissions, section, actionKey);
  }

  // Legacy fallback only for non-granular child modules.
  if (isChildModuleSection(section)) return false;

  if (legacyStringGrantsView(user, section) && actionKey === 'can_view') return true;
  return legacyRoleGrants(user, section, actionKey);
}

export function canViewSection(user, effectivePermissions, section) {
  return hasPermission(user, effectivePermissions, section, 'view');
}

export function canViewAnySection(user, effectivePermissions, sections) {
  return (sections || []).some((section) => canViewSection(user, effectivePermissions, section));
}

/** Edit SO line monthly rate + catalog config (admin, legacy grant, or replacement SO edit). */
export function canEditSoLineRateConfig(user, effectivePermissions) {
  if (!user) return false;
  if (user.role === 'super_admin' || user.role === 'admin') return true;
  const perms = Array.isArray(user.permissions) ? user.permissions : [];
  if (perms.includes('so_line_rate_config_edit')) return true;
  if (effectivePermissions && Object.keys(effectivePermissions).length > 0) {
    return resolveEffectivePermission(effectivePermissions, 'sales_orders_replacement', 'can_edit')
      || resolveEffectivePermission(effectivePermissions, 'replacement_so_laptop_qc', 'can_edit')
      || resolveEffectivePermission(effectivePermissions, 'so_laptop_qc', 'can_edit');
  }
  return false;
}

/** Partial SO line cancel — admin or sales_order_cancel edit grant. */
export function canPartialCancelSalesOrder(user, effectivePermissions) {
  if (!user) return false;
  if (user.role === 'super_admin' || user.role === 'admin') return true;
  if (effectivePermissions && Object.keys(effectivePermissions).length > 0) {
    return resolveEffectivePermission(effectivePermissions, 'sales_order_cancel', 'can_edit');
  }
  return false;
}

/** Accordion visibility: explicit parent grant OR any child with view access. */
export function canViewParentModule(user, effectivePermissions, parentSection) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  if (
    effectivePermissions &&
    Object.keys(effectivePermissions).length > 0 &&
    resolveEffectivePermission(effectivePermissions, parentSection, 'view')
  ) {
    return true;
  }
  return childSectionsForParent(parentSection).some((child) =>
    canViewSection(user, effectivePermissions, child)
  );
}

export function getDataScope(user, effectivePermissions, section) {
  if (!user) return 'all';
  if (user.role === 'super_admin') return 'all';
  if (!effectivePermissions || !Object.keys(effectivePermissions).length) {
    return 'all';
  }
  const keys = sectionsToCheck(section);
  for (const key of keys) {
    const scope = effectivePermissions?.[key]?.data_scope;
    if (scope === 'all') return 'all';
  }
  for (const key of keys) {
    const scope = effectivePermissions?.[key]?.data_scope;
    if (scope === 'assigned') return 'assigned';
  }
  return 'all';
}

export function isAssignedDataOnly(user, effectivePermissions, section) {
  return getDataScope(user, effectivePermissions, section) === 'assigned';
}
