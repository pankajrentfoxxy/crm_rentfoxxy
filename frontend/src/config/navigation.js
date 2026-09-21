/**
 * The navigation tree (Part 1 §5).
 *
 * The menu renders from this file and nothing else. No hardcoded route-prefix
 * helper, no `user.role` check, no second source. Every leaf carries the
 * (section, action) the backend already enforces on that route, and visibility
 * is decided by the same matrix — so revoking a permission removes the link
 * rather than leaving it visible with a 403 behind it (finding X6).
 *
 * Eight sections, from Decision 7: Procure · Produce · Stock · Sell · Move ·
 * Serve · Money · Control. The RentFoxxy / Gorefurbo split is a filter INSIDE
 * Sell, never two branches — one laptop crossing books must not cross sections.
 *
 * Section names are the live ones from `permission_sections`, not invented.
 */

export const SECTIONS = [
  {
    key: 'procure',
    label: 'Procure',
    items: [
      { to: '/vendor-management/purchase-orders', label: 'Purchase Orders', section: 'vendor_management', action: 'view' },
      { to: '/vendor-management/grn', label: 'GRN', section: 'vendor_management', action: 'view' },
      { to: '/vendor-management/vendors', label: 'Vendors', section: 'vendor_management', action: 'view' },
      { to: '/vendor-management/vendor-return', label: 'Vendor Returns', section: 'vendor_return_to_vendor', action: 'view' },
      { to: '/vendor-management/vendor-repair', label: 'Vendor Repair', section: 'vendor_repair_dc', action: 'view' },
    ],
  },
  {
    key: 'produce',
    label: 'Produce',
    items: [
      { to: '/floor-pipeline/tickets', label: 'Floor Pipeline', section: 'floor_pipeline', action: 'view' },
      { to: '/floor-pipeline/tickets?stage=Diagnosis', label: 'Diagnosis', section: 'floor_tickets', action: 'view' },
      { to: '/floor-pipeline/tickets?stage=QC1', label: 'QC1', section: 'floor_tickets', action: 'view' },
      { to: '/floor-pipeline/tickets?stage=QC2', label: 'QC2', section: 'floor_tickets', action: 'view' },
      { to: '/floor-pipeline/tickets?stage=Chip%20Level%20Repair', label: 'Chip Level Repair', section: 'chip_level_repair', action: 'view' },
      { to: '/floor-pipeline/pending-inventory', label: 'Pending Inventory', section: 'pending_inventory', action: 'view' },
      // QC Management is absorbed into Produce (Decision 7) rather than kept as
      // its own module — being separate is what let it keep its own status
      // vocabulary, which is finding I4.
      { to: '/qc-management/orders', label: 'QC Management', section: 'qc_management', action: 'view' },
      { to: '/tickets', label: 'Production Tickets', section: 'tickets', action: 'view' },
      { to: '/inventory-management/parts', label: 'Parts', section: 'parts_inventory', action: 'view' },
      { to: '/inventory-management/part-vendor-repair', label: 'Part Repairs', section: 'part_vendor_repair', action: 'view' },
    ],
  },
  {
    key: 'stock',
    label: 'Stock',
    items: [
      { to: '/inventory-management/universal-search', label: 'Assets', section: 'inventory_management', action: 'view' },
      // Part 2.7, behind REACT_APP_CARRET. Sits beside the existing screen
      // rather than replacing it — nothing is deleted until its replacement is
      // signed off (hard rule 6).
      { to: '/carret/stock/assets', label: 'Assets (Carret)', section: 'inventory_management', action: 'view' },
      { to: '/inventory-management/ready-to-rent-or-sell', label: 'Ready to Rent or Sell', section: 'ready_to_rent_location', action: 'view' },
      { to: '/inventory-management/asset-movement', label: 'Asset Movements', section: 'inventory_asset_movement', action: 'view' },
      { to: '/inventory-management/scrap-challans', label: 'Scrapped', section: 'scrap_challans', action: 'view' },
      { to: '/inventory-management/master-data', label: 'Master Data', section: 'inventory_master_data', action: 'view' },
      { to: '/inventory-management/npa-assets', label: 'NPA Assets', section: 'inventory_management', action: 'view' },
      { to: '/customer-inventory', label: 'Customer Inventory', section: 'customer_inventory', action: 'view' },
      // Bucket C: finished work that had no menu entry until now.
      { to: '/asset-configuration', label: 'Asset Configuration', section: 'asset_configuration', action: 'view' },
    ],
  },
  {
    key: 'sell',
    label: 'Sell',
    items: [
      { to: '/lead-crm/leads', label: 'Leads', section: 'leads', action: 'view' },
      { to: '/lead-crm/follow-ups', label: 'Follow-ups', section: 'lead_follow_ups', action: 'view' },
      { to: '/sales-pipeline/quotations', label: 'Quotations', section: 'sales_quotations', action: 'view' },
      { to: '/sales-pipeline/sales-orders', label: 'Sales Orders', section: 'sales_orders_doc', action: 'view' },
      // Part 4.5, behind REACT_APP_CARRET. Beside the existing screens; the
      // legacy chain is retired only once these are signed off (hard rule 6).
      { to: '/carret/sell/quotations', label: 'Quotations (Carret)', section: 'sales_quotations', action: 'view' },
      { to: '/carret/sell/sales-orders', label: 'Sales Orders (Carret)', section: 'sales_orders_doc', action: 'view' },
      { to: '/carret/sell/customers', label: 'Customers (Carret)', section: 'customer_management', action: 'view' },
      { to: '/customer-management/customers', label: 'Customers', section: 'customer_management', action: 'view' },
      { to: '/sales-pipeline/demo', label: 'Demo Agreements', section: 'demo_management', action: 'view' },
      { to: '/sales-pipeline/sale-in-place', label: 'Sale in Place', section: 'sale_in_place', action: 'view' },
    ],
  },
  {
    key: 'move',
    label: 'Move',
    items: [
      { to: '/sales-pipeline/delivery-challans', label: 'Delivery Challans', section: 'delivery_challans', action: 'view' },
      { to: '/sales-pipeline/return-dc', label: 'Return Challans', section: 'return_dc', action: 'view' },
      { to: '/guard', label: 'Guard Gate', section: 'guard_gate_checking', action: 'view' },
      // Part 3.7, behind REACT_APP_CARRET — beside the existing screens, not
      // replacing them (hard rule 6).
      { to: '/carret/move/gate', label: 'Guard Gate (Carret)', section: 'guard_gate_checking', action: 'view' },
      { to: '/carret/move/challans', label: 'Challans (Carret)', section: 'delivery_challans', action: 'view' },
      { to: '/carret/move/return-challans', label: 'Return Challans (Carret)', section: 'return_dc', action: 'view' },
      { to: '/guard/scanner', label: 'Gate Scanner', section: 'gate_dashboard', action: 'view' },
      { to: '/floor-pipeline/tickets?stage=Dispatch%20QC', label: 'Dispatch QC', section: 'dispatch_qc', action: 'view' },
      { to: '/sales-pipeline/delivery-register', label: 'Delivery Register', section: 'delivery_register_management', action: 'view' },
      { to: '/delivery-register-management/technicians', label: 'Delivery Technicians', section: 'delivery_register_management', action: 'view' },
      { to: '/sales-pipeline/bluedart-tracking', label: 'Courier & Tracking', section: 'bluedart_awb_tracking', action: 'view' },
      { to: '/dispatch/pending-orders', label: 'Pending Dispatch', section: 'dispatch_pending_orders', action: 'view' },
      { to: '/inventory-management/dispatch-chargers', label: 'Dispatch Chargers', section: 'dispatch_charger', action: 'view' },
    ],
  },
  {
    key: 'serve',
    label: 'Serve',
    // Placeholder until Part 6 rebuilds the support UI. These are the live v1
    // routes, which keep working — nothing is deleted before its replacement is
    // signed off.
    items: [
      { to: '/support/tickets', label: 'Support Queue', section: 'support_tickets', action: 'view' },
      { to: '/support/parts-queue', label: 'Parts Requests', section: 'support_part_requests', action: 'view' },
      { to: '/support-parts/queue', label: 'Parts Challans', section: 'support_part_challan', action: 'view' },
      { to: '/support/tech-bucket', label: 'Technician Bucket', section: 'technician_bucket', action: 'view' },
      { to: '/support/technicians', label: 'Technicians', section: 'support_technician', action: 'view' },
      { to: '/support/settings', label: 'Support Settings', section: 'support_settings', action: 'view' },
    ],
  },
  {
    key: 'money',
    label: 'Money',
    items: [
      { to: '/finance/invoices', label: 'Customer Invoices', section: 'customer_billing', action: 'view' },
      { to: '/finance/credit-notes', label: 'Credit Notes', section: 'credit_notes', action: 'view' },
      { to: '/finance/security-deposits', label: 'Security Deposits', section: 'security_deposits', action: 'view' },
      { to: '/finance/vendor-bills', label: 'Vendor Bills', section: 'vendor_billing_mgmt', action: 'view' },
      { to: '/finance/debit-notes', label: 'Debit Notes', section: 'debit_notes', action: 'view' },
      { to: '/finance/payments', label: 'Payments', section: 'payment_records', action: 'view' },
      { to: '/finance/dashboard', label: 'Billing Dashboard', section: 'billing_dashboard', action: 'view' },
      { to: '/finance/dc-invoice', label: 'DC Invoice Queue', section: 'customer_billing', action: 'view' },
      { to: '/finance/sale-invoice-queue', label: 'Sale Invoice Queue', section: 'customer_billing', action: 'view' },
      { to: '/finance/einvoice-queue', label: 'E-invoice Queue', section: 'einvoice_ewb', action: 'view' },
      { to: '/finance/eway-bills', label: 'E-way Bills', section: 'dc_eway_bill', action: 'view' },
    ],
  },
  {
    key: 'control',
    label: 'Control',
    items: [
      { to: '/dashboard', label: 'Overview', section: 'dashboard', action: 'view' },
      { to: '/carret', label: 'Operations (Carret)', section: 'dashboard', action: 'view' },
      { to: '/settings/roles', label: 'Roles & Permissions', section: 'roles', action: 'view' },
      { to: '/settings/role-permissions', label: 'Role Permissions', section: 'role_permissions', action: 'view' },
      { to: '/settings/user-permissions', label: 'User Permissions', section: 'user_permissions', action: 'view' },
      { to: '/settings/role-reference', label: 'Role Reference', section: 'roles', action: 'view' },
      { to: '/settings/users', label: 'Users', section: 'users', action: 'view' },
      { to: '/teams', label: 'Teams', section: 'teams', action: 'view' },
      { to: '/settings/companies', label: 'Settings', section: 'company_settings', action: 'view' },
      { to: '/reports', label: 'Reports', section: 'reports_access', action: 'view' },
    ],
  },
];

/**
 * Routes that are correctly absent from the menu. The CI check reads this, so
 * every entry is a decision someone made rather than an oversight nobody
 * noticed — which is the difference between this list and the 53 routes the
 * legacy menu could not reach.
 */
export const UNREACHABLE_BY_DESIGN = [
  // Public, unauthenticated capture links (server.js mounts six families).
  '/', '/login', '/access', '/auth/impersonate',
  '/register/customer', '/register/vendor',
  '/support/request',
  '/dispatch-qc-config-match', '/qc2-config-match', '/rdc-config-match',
  '/vendor-return-config-match',

  // The technician shell is its own app at field density, reached by its own
  // login rather than from the desk menu.
  '/technician', '/technician/login', '/technician/dashboard',
  '/technician/profile', '/technician/auth/callback',

  // Legacy chain — retired in Part 4, deliberately not given a menu entry now.
  // Giving these a link would be the redesign "giving both copies a nicer menu
  // entry", which is the thing the audit warns about.
  '/orders', '/sales', '/qc-orders', '/dispatch', '/inventory',
  '/leads', '/customers', '/follow-ups', '/lead-orders',
  '/warehouse', '/procurement',

  // Superseded by the sales-pipeline equivalents already in Sell and Move.
  '/operation-management/quotations', '/operation-management/quotations/add',
  '/operation-management/sales-orders', '/operation-management/sales-orders/add',
  '/operation-management/delivery-challans', '/operation-management/delivery-challans/add',
  '/operation-management/return-dc',
  '/customer-management/customers/add',
  '/delivery-register-management',
  '/delivery-register-management/bucket-list',
  '/delivery-register-management/delivered',
  '/delivery-register-management/in-transit',
  '/delivery-register-management/rejected',
  '/delivery-register-management/technicians/add',
  '/settings/asset-configuration',
  '/parts',
  '/tickets/create',
  '/asset-configuration/laptop',
  '/asset-configuration/spare-parts',
  '/qc-management/*',
  '/sales-management/*',

  // Superseded by /finance/* which is in Money. Kept routed until Part 6
  // replaces the billing screens; giving both a menu entry is the duplication
  // the audit is about.
  '/customer-billing/*',
  '/vendor-billing/*',
];

/** Flat list of every leaf, for the CI check and for search. */
export const ALL_ITEMS = SECTIONS.flatMap((s) =>
  s.items.map((i) => ({ ...i, sectionKey: s.key, sectionLabel: s.label }))
);
