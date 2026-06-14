import {
  BarChart3,
  BarChart2,
  TrendingUp,
  Users,
  UserCheck,
  Package,
  Truck,
  Building2,
  CheckCircle,
  ShoppingCart,
  Store,
  Settings,
  ClipboardCheck,
  Wrench,
  LayoutDashboard,
  FileText,
  CreditCard,
  Shield,
  AlertCircle,
  Zap,
  DollarSign,
  Headphones,
} from 'lucide-react';

/** Vendor Management accordion */
export const vendorAccordionChildren = [
  { label: 'Purchase Orders', path: '/vendor-management/purchase-orders' },
  { label: 'Spare Parts PO', path: '/vendor-management/spare-parts-po' },
  { label: 'GRN / Received', path: '/vendor-management/purchase-orders' },
  { label: 'Vendor Billing', path: '/vendor-management/billing/vendor-overview' },
  { label: 'Monthly Bills', path: '/vendor-management/billing/pending' },
];

/** Production accordion (formerly Floor & Quality).
 *  All pages live under /floor-pipeline/* which is guarded by a single
 *  'floor_pipeline' section, so every child uses that section to keep the
 *  sidebar in lock-step with what the route actually allows. */
export const floorPipelineAccordionChildren = [
  { label: 'Floor Dashboard', path: '/floor-pipeline/dashboard', section: 'floor_pipeline' },
  { label: 'All Tickets', path: '/floor-pipeline/tickets', section: 'floor_pipeline' },
  { label: 'QC Queue', path: '/floor-pipeline/tickets?stage=QC1,QC2', section: 'floor_pipeline' },
  { label: 'Chip Level Repair', path: '/floor-pipeline/tickets?stage=Chip+Level+Repair', section: 'floor_pipeline' },
  { label: 'Body & Paint', path: '/floor-pipeline/tickets?stage=Body+%26+Paint', section: 'floor_pipeline' },
];

/** Inventory accordion. Stock/Ready/Parts live under /inventory-management/*
 *  (guarded by 'inventory_management'); Customer Assets routes into
 *  /lead-crm/customers (guarded by 'customers'). Sections mirror the routes. */
export const inventoryAccordionChildren = [
  { label: 'Stock Management', path: '/inventory-management/universal-search', section: 'inventory_management' },
  { label: 'Ready to Rent/Sell', path: '/inventory-management/ready-to-rent-or-sell', countKey: 'passed', section: 'inventory_management' },
  { label: 'Parts Inventory', path: '/inventory-management/parts', section: 'inventory_management' },
  { label: 'Customer Assets', path: '/lead-crm/customers', section: 'customers' },
];

/** Sales Pipeline. All pages live under /sales-pipeline/* (single
 *  'sales_pipeline' guard) except Demo Agreements (its own 'demo_management'
 *  route), so sections match the route guards exactly. */
export const salesPipelineAccordionChildren = [
  { label: 'Quotations', path: '/sales-pipeline/quotations', section: 'sales_pipeline', countKey: 'quotations' },
  { label: 'Sales Orders', path: '/sales-pipeline/sales-orders', section: 'sales_pipeline', countKey: 'sales_orders' },
  { label: 'Delivery Challans', path: '/sales-pipeline/delivery-challans', section: 'sales_pipeline', countKey: 'delivery_challans' },
  { label: 'Delivery Register', path: '/sales-pipeline/delivery-register', section: 'sales_pipeline' },
  { label: 'Return DC', path: '/sales-pipeline/return-dc', section: 'sales_pipeline', countKey: 'return_dc' },
  { label: 'Demo Agreements', path: '/sales-pipeline/demo', section: 'demo_management' },
];

export const reportsMenuItems = [
  { icon: BarChart2, label: 'Manager Dashboard', path: '/reports/manager-dashboard', section: 'analytics_dashboard' },
  { icon: TrendingUp, label: 'Sales Dashboard', path: '/reports/sales-dashboard', section: 'analytics_dashboard' },
  { icon: DollarSign, label: 'Revenue', path: '/reports/revenue', section: 'reports_access' },
  { icon: Package, label: 'Inventory', path: '/reports/inventory', section: 'reports_access' },
  { icon: Users, label: 'Lead Conversion', path: '/reports/lead-conversion', section: 'reports_access' },
  { icon: UserCheck, label: 'Salesperson', path: '/reports/salesperson', section: 'reports_access' },
  { icon: CreditCard, label: 'Collections', path: '/reports/collections', section: 'reports_access' },
  { icon: Building2, label: 'Vendor Spend', path: '/reports/vendor-spend', section: 'reports_access' },
  { icon: Wrench, label: 'Technician', path: '/reports/technician', section: 'reports_access' },
];

// Sections mirror the actual route guards: /customer-billing/* -> customer_billing,
// /vendor-billing/* -> vendor_billing_mgmt, /finance/dashboard -> billing_dashboard,
// /finance/einvoice-queue -> einvoice_ewb. (Credit/Security/Debit pages share their
// module's guard, so they use the module section — not a separate granular one.)
export const financeMenuItems = [
  { icon: LayoutDashboard, label: 'Finance Dashboard', path: '/finance/dashboard', section: 'billing_dashboard' },
  { icon: FileText, label: 'Customer Invoices', path: '/customer-billing/invoices', section: 'customer_billing', countKey: 'draft_invoices' },
  { icon: CreditCard, label: 'Credit Notes', path: '/customer-billing/credit-notes', section: 'customer_billing' },
  { icon: Shield, label: 'Security Deposits', path: '/customer-billing/security-deposits', section: 'customer_billing' },
  { icon: Building2, label: 'Vendor Bills', path: '/vendor-billing/bills', section: 'vendor_billing_mgmt' },
  { icon: AlertCircle, label: 'Debit Notes', path: '/vendor-billing/debit-notes', section: 'vendor_billing_mgmt' },
  { icon: Zap, label: 'E-Invoice Queue', path: '/finance/einvoice-queue', section: 'einvoice_ewb', countKey: 'einvoice_queue' },
];

export const leadCrmAccordionChildren = [
  { label: 'Leads Pipeline', path: '/lead-crm/leads', section: 'leads', countKey: 'active_leads' },
  { label: 'Follow-ups', path: '/lead-crm/follow-ups', section: 'follow_ups', countKey: 'followups_today' },
];

export const masterDataMenuItems = [
  { icon: Users, label: 'Customers', path: '/lead-crm/customers', section: 'customers' },
  { icon: Building2, label: 'Vendors', path: '/vendor-management/vendors', section: 'vendor_management' },
];

export const settingsAccordionChildren = [
  { label: 'Users', path: '/settings/users', section: 'users' },
  { label: 'Role Permissions', path: '/settings/role-permissions', section: 'role_permissions' },
  { label: 'User Overrides', path: '/settings/user-permissions', section: 'user_permissions' },
  { label: 'Roles', path: '/settings/roles', section: 'roles' },
  { label: 'Role Reference', path: '/settings/role-reference', section: 'roles' },
  // (role-reference shares the 'roles' section so Settings never shows for non-admins)
  { label: 'Companies', path: '/settings/companies', section: 'company_settings' },
];

/** Legacy exports — kept for Layout imports; not shown in sidebar */
export const qcAccordionChildren = [];
export const deliveryRegisterAccordionChildren = [];
export const operationAccordionChildren = salesPipelineAccordionChildren;

/**
 * Sidebar menu configuration — visibility driven by hasPermission(section, 'view')
 */
export const MENU_GROUPS = [
  {
    key: 'reports',
    label: 'Reports & Analytics',
    items: [
      {
        type: 'reportsAccordion',
        icon: BarChart2,
        label: 'Reports & Analytics',
        section: 'analytics_dashboard',
        children: reportsMenuItems,
      },
    ],
  },
  {
    key: 'master_data',
    label: 'Master Data',
    items: masterDataMenuItems,
  },
  {
    key: 'lead_crm',
    label: 'Lead & Sales CRM',
    items: [
      { type: 'leadCrmAccordion', icon: Users, label: 'Lead & Sales CRM', section: 'leads' },
    ],
  },
  {
    key: 'sales_pipeline',
    label: 'Sales Pipeline',
    items: [
      {
        type: 'salesPipelineAccordion',
        icon: ShoppingCart,
        label: 'Sales Pipeline',
        section: 'sales_pipeline',
        children: salesPipelineAccordionChildren,
      },
    ],
  },
  {
    key: 'floor_quality',
    label: 'Production',
    items: [
      {
        type: 'floorPipelineAccordion',
        section: 'floor_pipeline',
        icon: Wrench,
        label: 'Production',
      },
    ],
  },
  {
    key: 'inventory',
    label: 'Inventory',
    items: [
      {
        type: 'inventoryAccordion',
        sections: ['inventory_management', 'customers'],
        section: 'inventory_management',
        icon: Package,
        label: 'Inventory',
      },
    ],
  },
  {
    key: 'vendor',
    label: 'Vendor Management',
    items: [
      { type: 'vendorAccordion', section: 'vendor_management', icon: Store, label: 'Vendor Management' },
    ],
  },
  {
    key: 'finance',
    label: 'Finance',
    items: [
      {
        type: 'financeAccordion',
        icon: DollarSign,
        label: 'Finance',
        section: 'customer_billing',
        children: financeMenuItems,
      },
    ],
  },
  {
    key: 'support',
    label: 'Support',
    items: [
      {
        icon: Headphones,
        label: 'Support',
        path: '/support',
        section: 'support_tickets',
        countKey: 'open_tickets',
      },
    ],
  },
  {
    key: 'settings',
    label: 'Settings',
    items: [
      {
        type: 'settingsAccordion',
        icon: Settings,
        label: 'Settings',
        sections: ['users', 'user_permissions', 'role_permissions', 'roles'],
      },
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

  if (item.type === 'salesPipelineAccordion') {
    if (item.section && canView(item.section)) return true;
    return (item.children || []).some((child) => (child.section ? canView(child.section) : true));
  }

  if (item.type === 'financeAccordion') {
    if (item.section && canView(item.section)) return true;
    return (item.children || []).some((child) => (child.section ? canView(child.section) : true));
  }

  if (item.type === 'reportsAccordion') {
    return (item.children || []).some((child) => (child.section ? canView(child.section) : true));
  }

  if (item.type === 'deliveryRegisterAccordion') {
    return (item.sections || []).some((section) => canView(section));
  }

  if (item.type === 'inventoryAccordion') {
    if (item.sections?.length) {
      return item.sections.some((section) => canView(section));
    }
    return item.section ? canView(item.section) : false;
  }

  if (
    item.type === 'vendorAccordion'
    || item.type === 'floorPipelineAccordion'
    || item.type === 'leadCrmAccordion'
    || item.type === 'salesPipelineAccordion'
    || item.type === 'financeAccordion'
    || item.type === 'reportsAccordion'
    || item.type === 'qcAccordion'
    || item.type === 'inventoryAccordion'
  ) {
    if (item.sections?.length) {
      return item.sections.some((section) => canView(section));
    }
    return item.section ? canView(item.section) : false;
  }

  if (item.section) return canView(item.section);
  return true;
}

export function isLeadCrmChildVisible(child, canView) {
  if (child.section) return canView(child.section);
  return true;
}

export function isOperationChildVisible(child, canView) {
  if (child.section) return canView(child.section);
  return true;
}

export function isSalesPipelineChildVisible(child, canView) {
  if (child.section) return canView(child.section);
  return true;
}

export function isFinanceChildVisible(child, canView) {
  if (child.section) return canView(child.section);
  return true;
}

export function isReportsChildVisible(child, canView, userRole) {
  if (child.path === '/reports/manager-dashboard' && userRole === 'sales') return false;
  if (child.path === '/reports/sales-dashboard' && !['admin', 'manager', 'sales'].includes(userRole)) {
    return canView(child.section);
  }
  if (child.section === 'reports_access') {
    return canView('reports_access') || canView('reports');
  }
  if (child.section) return canView(child.section);
  return true;
}

export function isSettingsChildVisible(child, canView) {
  if (child.section) return canView(child.section);
  return true;
}

export function isInventoryChildVisible(child, canView) {
  if (child.section) return canView(child.section);
  return true;
}

export function isDeliveryRegisterChildVisible(child, canView) {
  if (child.section) return canView(child.section);
  return true;
}

export function isFloorPipelineChildVisible(child, canView) {
  if (child.section) return canView(child.section);
  return true;
}
