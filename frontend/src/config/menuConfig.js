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

/** Floor & Quality accordion (includes Parts) */
export const floorPipelineAccordionChildren = [
  { label: 'Floor Dashboard', path: '/floor-pipeline/dashboard', section: 'floor_pipeline' },
  { label: 'All Tickets', path: '/floor-pipeline/tickets', section: 'floor_pipeline' },
  { label: 'QC Queue', path: '/floor-pipeline/tickets?stage=QC1,QC2', section: 'floor_pipeline' },
  { label: 'Chip Level Repair', path: '/floor-pipeline/tickets?stage=Chip+Level+Repair', section: 'chip_level_repair' },
  { label: 'Body & Paint', path: '/floor-pipeline/tickets?stage=Body+%26+Paint', section: 'floor_pipeline' },
  { label: 'Parts', path: '/parts', section: 'parts' },
];

/** Inventory accordion (simplified) */
export const inventoryAccordionChildren = [
  { label: 'Stock Management', path: '/inventory-management/universal-search', section: 'inventory_management' },
  { label: 'Ready to Rent/Sell', path: '/inventory-management/ready-to-rent-or-sell', countKey: 'passed', section: 'inventory_management' },
  { label: 'Customer Inventory', path: '/customer-inventory', section: 'customer_inventory' },
];

export const salesPipelineAccordionChildren = [
  { label: 'Quotations', path: '/sales-pipeline/quotations', section: 'sales_quotations', countKey: 'quotations' },
  { label: 'Sales Orders', path: '/sales-pipeline/sales-orders', section: 'sales_orders_doc', countKey: 'sales_orders' },
  { label: 'Delivery Challans', path: '/sales-pipeline/delivery-challans', section: 'delivery_challans', countKey: 'delivery_challans' },
  { label: 'Delivery Register', path: '/sales-pipeline/delivery-register', section: 'delivery_register_management' },
  { label: 'Return DC', path: '/sales-pipeline/return-dc', section: 'return_dc', countKey: 'return_dc' },
];

export const reportsMenuItems = [
  { icon: BarChart2, label: 'Manager Dashboard', path: '/reports/manager-dashboard', section: 'analytics_dashboard' },
  { icon: TrendingUp, label: 'Sales Dashboard', path: '/reports/sales-dashboard', section: 'analytics_dashboard' },
  { icon: DollarSign, label: 'Revenue', path: '/reports/revenue', section: 'reports' },
  { icon: Package, label: 'Inventory', path: '/reports/inventory', section: 'reports' },
  { icon: Users, label: 'Lead Conversion', path: '/reports/lead-conversion', section: 'reports' },
  { icon: UserCheck, label: 'Salesperson', path: '/reports/salesperson', section: 'reports' },
  { icon: CreditCard, label: 'Collections', path: '/reports/collections', section: 'reports' },
  { icon: Building2, label: 'Vendor Spend', path: '/reports/vendor-spend', section: 'reports' },
  { icon: Wrench, label: 'Technician', path: '/reports/technician', section: 'reports' },
];

export const financeMenuItems = [
  { icon: LayoutDashboard, label: 'Finance Dashboard', path: '/finance/dashboard', section: 'billing_dashboard' },
  { icon: FileText, label: 'Customer Invoices', path: '/customer-billing/invoices', section: 'customer_billing', countKey: 'draft_invoices' },
  { icon: CreditCard, label: 'Credit Notes', path: '/customer-billing/credit-notes', section: 'credit_notes' },
  { icon: Shield, label: 'Security Deposits', path: '/customer-billing/security-deposits', section: 'security_deposits' },
  { icon: Building2, label: 'Vendor Bills', path: '/vendor-billing/bills', section: 'vendor_billing_mgmt' },
  { icon: AlertCircle, label: 'Debit Notes', path: '/vendor-billing/debit-notes', section: 'debit_notes' },
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
  { label: 'Users', path: '/settings/user-permissions', section: 'user_permissions' },
  { label: 'Role Permissions', path: '/settings/role-permissions', section: 'role_permissions' },
  { label: 'Teams', path: '/teams', section: 'teams' },
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
    key: 'home',
    label: 'Overview',
    items: [
      { icon: BarChart3, label: 'Dashboard', path: '/dashboard', section: 'dashboard' },
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
    label: 'Floor & Quality',
    items: [
      {
        type: 'floorPipelineAccordion',
        section: 'floor_pipeline',
        icon: Wrench,
        label: 'Floor & Quality',
      },
    ],
  },
  {
    key: 'inventory',
    label: 'Inventory',
    items: [
      {
        type: 'inventoryAccordion',
        sections: ['inventory_management', 'customer_inventory'],
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
    key: 'settings',
    label: 'Settings',
    items: [
      {
        type: 'settingsAccordion',
        icon: Settings,
        label: 'Settings',
        sections: ['users', 'user_permissions', 'role_permissions', 'teams', 'roles'],
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
