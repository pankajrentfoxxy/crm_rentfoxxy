/** Canonical application permission section keys */
export const APPLICATION_SECTIONS = [
  'dashboard',
  'inventory',
  'tickets',
  'leads',
  'sales_orders',
  'follow_ups',
  'lead_orders',
  'customers',
  'manager_dashboard',
  'reports',
  'parts',
  'procurement',
  'vendor_management',
  'warehouse',
  'qc_management',
  'inventory_management',
  'dispatch',
  'support_tickets',
  'customer_inventory',
  'teams',
  'roles',
  'role_permissions',
  'user_permissions',
];

export const SECTION_LABELS = {
  dashboard: 'Dashboard',
  inventory: 'Inventory',
  tickets: 'Tickets',
  leads: 'Leads',
  sales_orders: 'Sales Orders',
  follow_ups: 'Follow Ups',
  lead_orders: 'Lead Orders',
  customers: 'Customers',
  manager_dashboard: 'Manager Dashboard',
  reports: 'Reports',
  parts: 'Parts',
  procurement: 'Procurement',
  vendor_management: 'Vendor Management',
  warehouse: 'Warehouse',
  qc_management: 'QC Management',
  inventory_management: 'Inventory Management',
  dispatch: 'Dispatch',
  support_tickets: 'Support Tickets',
  customer_inventory: 'Customer Inventory',
  teams: 'Teams',
  roles: 'Roles',
  role_permissions: 'Role Permissions',
  user_permissions: 'User Permissions',
};

export const PERMISSION_ACTIONS = ['can_view', 'can_create', 'can_edit', 'can_delete'];

export const ACTION_ALIASES = {
  view: 'can_view',
  create: 'can_create',
  edit: 'can_edit',
  delete: 'can_delete',
};

export function normalizeAction(action) {
  if (!action) return null;
  const key = String(action).trim();
  if (PERMISSION_ACTIONS.includes(key)) return key;
  return ACTION_ALIASES[key] || null;
}
