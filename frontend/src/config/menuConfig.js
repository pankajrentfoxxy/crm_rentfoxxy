import {
  BarChart3,
  Archive,
  ClipboardList,
  Briefcase,
  Clock,
  Users,
  Package,
  Truck,
  Headphones,
  Building2,
  CheckCircle,
  ShoppingCart,
  Store,
  Settings,
  Cog,
} from 'lucide-react';

/** Vendor submenu paths match VendorManagementApp nested routes */
export const vendorAccordionChildren = [
  { label: 'Vendors', path: '/vendor-management/vendors' },
  { label: 'Purchase order', path: '/vendor-management/purchase-orders' },
  { label: 'Spare parts PO', path: '/vendor-management/spare-parts-po' },
  { label: 'Update serial number', path: '/vendor-management/serial-numbers' },
  { label: 'Replaced product', path: '/vendor-management/replaced-products' },
  { type: 'subheader', label: 'Billing' },
  { label: 'Vendor billing', path: '/vendor-management/billing/vendor-overview' },
  { label: 'Monthly pending', path: '/vendor-management/billing/pending' },
  { label: 'Monthly approved', path: '/vendor-management/billing/approved' },
  { label: 'Monthly completed', path: '/vendor-management/billing/completed' },
];

export const qcAccordionChildren = [
  { label: 'QC Processing List', path: '/qc-management/processing', countKey: 'pending' },
  { label: 'QC Passed List', path: '/qc-management/passed', countKey: 'passed' },
  { label: 'QC Failed List', path: '/qc-management/failed', countKey: 'failed' },
  { label: 'Dead Assets List', path: '/qc-management/dead-assets', countKey: 'dead' },
  { label: 'Require For Parts', path: '/qc-management/require-for-parts', countKey: 'require_for_parts' },
  { label: 'Bundle Management', path: '/qc-management/bundle' },
];

export const inventoryAccordionChildren = [
  { label: 'Ready to Rent or Sell', path: '/inventory-management/ready-to-rent-or-sell', countKey: 'passed' },
  { label: 'Rent To Own', path: '/inventory-management/rent-to-own', countKey: 'rent_to_own' },
  { label: 'Rental Purchase', path: '/inventory-management/rental-purchase', countKey: 'rental_purchase' },
  { label: 'Direct Purchase', path: '/inventory-management/direct-purchase', countKey: 'direct_purchase' },
  { label: 'Out For Repare', path: '/inventory-management/out-for-repare', countKey: 'out_for_repare' },
  { label: 'Spare Parts', path: '/inventory-management/spare-parts', countKey: 'spare_parts' },
  { label: 'Serial Number Status', path: '/inventory-management/serial-number-status' },
  { label: 'Universal Search', path: '/inventory-management/universal-search' },
  { label: 'NPA Assets', path: '/inventory-management/npa-assets', countKey: 'npa' },
];

export const operationAccordionChildren = [
  { label: 'Quotations', path: '/operation-management/quotations', section: 'sales_quotations', countKey: 'quotations' },
  { label: 'Sales Orders', path: '/operation-management/sales-orders', section: 'sales_orders_doc', countKey: 'sales_orders' },
  { label: 'Delivery Challans', path: '/operation-management/delivery-challans', section: 'delivery_challans', countKey: 'delivery_challans' },
  { label: 'Return DC', path: '/operation-management/return-dc', section: 'return_dc', countKey: 'return_dc' },
];

export const settingsAccordionChildren = [
  { label: 'Roles', path: '/settings/roles', section: 'roles' },
  { label: 'Role Permissions', path: '/settings/role-permissions', section: 'role_permissions' },
  { label: 'User Permissions', path: '/settings/user-permissions', section: 'user_permissions' },
];

/**
 * Sidebar menu configuration — visibility driven by hasPermission(section, 'view')
 */
export const MENU_GROUPS = [
  {
    key: 'sales',
    label: 'Sales',
    items: [
      { icon: BarChart3, label: 'Dashboard', path: '/dashboard', section: 'dashboard' },
      { icon: Archive, label: 'Inventory', path: '/inventory', section: 'inventory' },
      { icon: ClipboardList, label: 'Tickets', path: '/tickets', section: 'tickets' },
      { icon: Briefcase, label: 'Leads', path: '/leads', section: 'leads' },
      { icon: Briefcase, label: 'Sales Orders', path: '/sales', section: 'sales_orders' },
      { icon: Clock, label: 'Follow-ups', path: '/follow-ups', section: 'follow_ups' },
      { icon: ClipboardList, label: 'Lead Orders', path: '/lead-orders', section: 'lead_orders' },
      { icon: Users, label: 'Customers', path: '/customers', section: 'customers' },
      { icon: BarChart3, label: 'Manager Dashboard', path: '/manager-dashboard', section: 'manager_dashboard' },
      { icon: BarChart3, label: 'Reports', path: '/reports', section: 'reports' },
      { icon: Package, label: 'Parts', path: '/parts', section: 'parts' },
    ],
  },
  {
    key: 'operation',
    label: 'Operation Management',
    items: [
      {
        type: 'operationAccordion',
        icon: Cog,
        label: 'Operation Management',
        sections: ['sales_quotations', 'sales_orders_doc', 'delivery_challans', 'return_dc'],
      },
    ],
  },
  {
    key: 'warehouse',
    label: 'Warehouse',
    items: [
      { icon: Truck, label: 'Procurement', path: '/procurement', section: 'procurement' },
      { type: 'vendorAccordion', section: 'vendor_management', icon: Store, label: 'Vendor Management' },
      { icon: Package, label: 'Warehouse', path: '/warehouse', section: 'warehouse' },
      { type: 'qcAccordion', section: 'qc_management', icon: CheckCircle, label: 'QC Management' },
      { type: 'inventoryAccordion', section: 'inventory_management', icon: ShoppingCart, label: 'Inventory Management' },
      { icon: Truck, label: 'Dispatch', path: '/dispatch', section: 'dispatch' },
    ],
  },
  {
    key: 'customer_management',
    label: 'Customer Management',
    items: [
      { icon: Users, label: 'Customers', path: '/customer-management/customers', section: 'customer_management' },
    ],
  },
  {
    key: 'support',
    label: 'Support',
    items: [
      { icon: Headphones, label: 'Support tickets', path: '/support/tickets', section: 'support_tickets' },
      { icon: Building2, label: 'Customer Inventory', path: '/customer-inventory', section: 'customer_inventory' },
    ],
  },
  {
    key: 'team',
    label: 'Team',
    items: [
      { icon: Users, label: 'Teams', path: '/teams', section: 'teams' },
    ],
  },
  {
    key: 'settings',
    label: 'Settings',
    items: [
      { type: 'settingsAccordion', icon: Settings, label: 'Settings', sections: ['roles', 'role_permissions', 'user_permissions'] },
    ],
  },
];

/** Flat list for backward compatibility with existing Layout rendering */
export const FLAT_MENU_ITEMS = MENU_GROUPS.flatMap((group) => [
  { type: 'section', label: group.label, groupKey: group.key },
  ...group.items,
]);

export function isMenuItemVisible(item, canView) {
  if (item.type === 'section') {
    const group = MENU_GROUPS.find((g) => g.key === item.groupKey);
    if (!group) return false;
    return group.items.some((child) => isMenuItemVisible(child, canView));
  }

  if (item.type === 'settingsAccordion') {
    return (item.sections || []).some((section) => canView(section));
  }

  if (item.type === 'operationAccordion') {
    return (item.sections || []).some((section) => canView(section));
  }

  if (item.type === 'vendorAccordion' || item.type === 'qcAccordion' || item.type === 'inventoryAccordion') {
    return item.section ? canView(item.section) : false;
  }

  if (item.section) return canView(item.section);
  return true;
}

export function isOperationChildVisible(child, canView) {
  if (child.section) return canView(child.section);
  return true;
}

export function isSettingsChildVisible(child, canView) {
  if (child.section) return canView(child.section);
  return true;
}
