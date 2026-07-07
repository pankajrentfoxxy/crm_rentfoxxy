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

/** Vendor Management accordion (procurement only — billing lives under Finance).
 *  GRN / receiving happens inside the Purchase Orders page, so there is no
 *  separate "GRN" item (that was a duplicate link to Purchase Orders). */
export const vendorAccordionChildren = [
  { label: 'Purchase Orders', path: '/vendor-management/purchase-orders' },
  { label: 'Spare Parts PO', path: '/vendor-management/spare-parts-po' },
  { label: 'Serial Numbers', path: '/vendor-management/serial-numbers' },
  { label: 'Replaced Products', path: '/vendor-management/replaced-products' },
];

/** Production accordion (formerly Floor & Quality).
 *  Each child uses the granular RBAC section its page enforces — parent floor_pipeline
 *  does NOT unlock children (see sectionHierarchy.js). */
export const floorPipelineAccordionChildren = [
  { label: 'Floor Dashboard', path: '/floor-pipeline/dashboard', section: 'floor_pipeline' },
  { label: 'All Tickets', path: '/floor-pipeline/tickets', section: 'floor_tickets', countKey: 'all_tickets' },
  { label: 'QC Queue', path: '/floor-pipeline/tickets?stage=QC1,QC2', section: 'qc_management', countKey: 'qc_queue' },
  { label: 'Chip Level Repair', path: '/floor-pipeline/tickets?stage=Chip+Level+Repair', section: 'chip_level_repair', countKey: 'chip_level' },
  { label: 'Body & Paint', path: '/floor-pipeline/tickets?stage=Body+%26+Paint', section: 'floor_pipeline', countKey: 'body_paint' },
  { label: 'Diagnosis Failed', path: '/floor-pipeline/diagnosis-failed', section: 'floor_pipeline', countKey: 'diagnosis_failed' },
  { label: 'Vendor Repair DC', path: '/floor-pipeline/vendor-repair-dc', section: 'floor_pipeline' },
];

/** Inventory accordion — each child maps to the RBAC section the route/API enforces. */
export const inventoryAccordionChildren = [
  { label: 'Stock Management', path: '/inventory-management/universal-search', section: 'inventory_management' },
  { label: 'QC Process Laptops', path: '/inventory-management/qc-process', countKey: 'qc_process', section: 'inventory_management' },
  { label: 'Out for Repair', path: '/inventory-management/out-for-repair', countKey: 'out_for_repair', section: 'inventory_management' },
  { label: 'Ready to Rent/Sell', path: '/inventory-management/ready-to-rent-or-sell', countKey: 'passed', section: 'inventory_management' },
  { label: 'Parts Inventory', path: '/inventory-management/parts', section: 'parts_inventory' },
  { label: 'Parts Movement History', path: '/inventory-management/parts-history', section: 'parts_inventory' },
  { label: 'Parts Approval', path: '/inventory-management/parts-approval', countKey: 'parts_pending', section: 'parts_inventory' },
  { label: 'Deployed Fleet (All Customers)', path: '/inventory-management/customer-assets', section: 'customer_inventory' },
  { label: 'TTSPL History', path: '/inventory-management/ttspl-history', section: 'ttspl_history' },
];

/** Sales Pipeline. Each child uses the GRANULAR section its backend API enforces
 *  (sales_quotations / sales_orders_doc / delivery_challans / ...), so a user only
 *  sees the documents they can actually open — e.g. warehouse has delivery_challans
 *  but not sales_quotations, so it sees only Delivery Challans. */
export const salesPipelineAccordionChildren = [
  { label: 'Quotations', path: '/sales-pipeline/quotations', section: 'sales_quotations', countKey: 'quotations' },
  { label: 'Sales Orders – Sale', path: '/sales-pipeline/sales-orders-sale', section: 'sales_orders_sale', countKey: 'sales_orders_sale' },
  { label: 'Sales Orders – Rental', path: '/sales-pipeline/sales-orders-rental', section: 'sales_orders_rental', countKey: 'sales_orders_rental' },
  { label: 'Delivery Challans', path: '/sales-pipeline/delivery-challans', section: 'delivery_challans', countKey: 'delivery_challans' },
  { label: 'Delivery Register', path: '/sales-pipeline/delivery-register', section: 'delivery_register_management' },
  { label: 'Delivery Technicians', path: '/delivery-register-management/technicians', section: 'technician_bucket' },
  { label: 'Technician Bucket', path: '/sales-pipeline/technician-bucket', section: 'technician_bucket' },
  { label: 'My Deliveries', path: '/sales-pipeline/my-deliveries', section: 'technician_bucket' },
  { label: 'Return DC', path: '/sales-pipeline/return-dc', section: 'return_dc', countKey: 'return_dc' },
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

// Each section matches that page's REAL backend + route guard exactly, so a user
// sees a finance item only if they can actually open it (no "permission denied").
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
  { label: 'Users', path: '/settings/users', section: 'users' },
  { label: 'Role Permissions', path: '/settings/role-permissions', section: 'role_permissions' },
  { label: 'User Overrides', path: '/settings/user-permissions', section: 'user_permissions' },
  { label: 'Roles', path: '/settings/roles', section: 'roles' },
  { label: 'Role Reference', path: '/settings/role-reference', section: 'roles' },
  // (role-reference shares the 'roles' section so Settings never shows for non-admins)
  { label: 'Companies', path: '/settings/companies', section: 'company_settings' },
  { label: 'Laptop Configuration', path: '/asset-configuration/laptop', section: 'asset_configuration' },
  { label: 'Spare Parts Configuration', path: '/asset-configuration/spare-parts', section: 'asset_configuration' },
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
        sections: ['inventory', 'inventory_management', 'parts', 'parts_inventory', 'customer_inventory', 'ttspl_history'],
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
      {
        icon: ClipboardCheck,
        label: 'Support Part Queue',
        path: '/support-parts/queue',
        section: 'support_part_challan',
        countKey: 'support_part_requests',
      },
      {
        icon: Package,
        label: 'Technician Parts Bucket',
        path: '/support-parts/tech-bucket',
        section: 'support_part_requests',
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
    return (item.children || []).some((child) => isSalesPipelineChildVisible(child, canView));
  }

  if (item.type === 'financeAccordion') {
    return (item.children || []).some((child) => isFinanceChildVisible(child, canView));
  }

  if (item.type === 'reportsAccordion') {
    return (item.children || []).some((child) => isReportsChildVisible(child, canView));
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

  if (item.type === 'floorPipelineAccordion') {
    return floorPipelineAccordionChildren.some((child) => isFloorPipelineChildVisible(child, canView));
  }

  if (item.type === 'leadCrmAccordion') {
    return leadCrmAccordionChildren.some((child) => isLeadCrmChildVisible(child, canView));
  }

  if (
    item.type === 'vendorAccordion'
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
  return false;
}

export function isOperationChildVisible(child, canView) {
  if (child.section) return canView(child.section);
  return false;
}

export function isSalesPipelineChildVisible(child, canView) {
  if (child.section) return canView(child.section);
  return false;
}

export function isFinanceChildVisible(child, canView) {
  if (child.section) return canView(child.section);
  return false;
}

export function isReportsChildVisible(child, canView, userRole = null) {
  if (child.path === '/reports/manager-dashboard' && userRole === 'sales') return false;
  if (child.path === '/reports/sales-dashboard' && !['admin', 'manager', 'sales'].includes(userRole)) {
    return canView(child.section);
  }
  if (child.section === 'reports_access') {
    return canView('reports_access') || canView('reports');
  }
  if (child.section) return canView(child.section);
  return false;
}

export function isSettingsChildVisible(child, canView) {
  if (child.section) return canView(child.section);
  return false;
}

export function isInventoryChildVisible(child, canView) {
  if (child.section) return canView(child.section);
  return false;
}

export function isDeliveryRegisterChildVisible(child, canView) {
  if (child.section) return canView(child.section);
  return false;
}

export function isFloorPipelineChildVisible(child, canView) {
  if (child.section) return canView(child.section);
  return false;
}
