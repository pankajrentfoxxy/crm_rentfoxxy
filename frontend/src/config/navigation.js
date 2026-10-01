/**
 * The navigation tree (Part 1 §5).
 *
 * The menu renders from this file and nothing else. No hardcoded route-prefix
 * helper, no `user.role` check, no second source. Every leaf carries the
 * (section, action) the backend already enforces on that route, and visibility
 * is decided by the same matrix — so revoking a permission removes the link
 * rather than leaving it visible with a 403 behind it (finding X6).
 *
 * Eight sections, from Decision 7: Procure · Production · Stock · Sell · Move ·
 * Support · Finance · Control (renamed 27 Sep 2026: Procure → Procurement, Move → Movement,
 * Serve → Support, Money → Finance; keys and URLs unchanged). Decision 7 wrote this one as the verb "Produce" to
 * match Procure/Sell/Move/Serve; the floor calls it Production, and the menu
 * uses the word the people reading it use. The key stays `produce` so no route,
 * permission or test moves with the label. The RentFoxxy / Gorefurbo split is a filter INSIDE
 * Sell, never two branches — one laptop crossing books must not cross sections.
 *
 * Section names are the live ones from `permission_sections`, not invented.
 */

// Any one of these grants the sales-order screens (the backend's cpAny).
const SO_SECTIONS = ['sales_orders_doc', 'sales_orders_sale', 'sales_orders_rental', 'sales_orders_replacement'];

export const SECTIONS = [
  {
    key: 'procure',
    label: 'Procurement',
    // Procure to stock is complete in Carret (26 Sep 2026): these open the new
    // screens, in the order the process runs. The old ones stay under "Old
    // view" until the process is signed off (hard rule 6). Three old links
    // (/grn, /vendor-return, /vendor-repair) pointed at routes that do not
    // exist and are gone (B26).
    groups: ['Procure to stock'],
    items: [
      { group: 'Procure to stock', to: '/carret/procure/to-buy', label: 'To buy', section: 'vendor_management', action: 'view' },
      { group: 'Procure to stock', to: '/carret/procure/purchase-orders', label: 'Purchase Orders', section: 'vendor_management', action: 'view' },
      { group: 'Procure to stock', to: '/carret/procure/spare-parts-orders', label: 'Spare-parts Orders', sections: ['vendor_management', 'parts_procurement'], section: 'vendor_management', action: 'view' },
      { group: 'Procure to stock', to: '/carret/procure/arrivals', label: 'Vendor Arrivals', sections: ['guard_gate_checking', 'vendor_management'], section: 'vendor_management', action: 'view' },
      { group: 'Procure to stock', to: '/carret/procure/returns', label: 'Vendor Returns', sections: ['vendor_return_to_vendor', 'vendor_management', 'vendor_return_ticket', 'vendor_repair_dc', 'vendor_repair_dc_dispatch', 'floor_pipeline', 'diagnosis_failed'], section: 'vendor_return_to_vendor', action: 'view' },
      { group: 'Procure to stock', to: '/carret/procure/vendors', label: 'Vendors', section: 'vendor_management', action: 'view' },
      { group: 'Procure to stock', to: '/carret/procure/vendor-rentals', label: 'Vendor Rentals', sections: ['vendor_management', 'vendor_billing_mgmt', 'vendor_repair_dc'], section: 'vendor_management', action: 'view' },
      { group: 'Procure to stock', to: '/carret/procure/replacement-approvals', label: 'Replacement Approvals', sections: ['vendor_repair_dc', 'vendor_management', 'vendor_billing_mgmt'], section: 'vendor_repair_dc', action: 'view' },
    ],
  },
  {
    key: 'produce',
    label: 'Production',
    // Production in Carret (26 Sep 2026): the floor board, a laptop's ticket,
    // the parts desk and into-stock. The old screens stay under "Old view"
    // until the process is signed off (hard rule 6).
    groups: ['Production'],
    items: [
      { group: 'Production', to: '/carret/produce/floor', label: 'Floor', sections: ['floor_pipeline', 'floor_tickets'], section: 'floor_pipeline', action: 'view' },
      { group: 'Production', to: '/carret/produce/parts-desk', label: 'Parts Desk', sections: ['parts_approval', 'parts_inventory'], section: 'parts_approval', action: 'view' },
      { group: 'Production', to: '/carret/produce/into-stock', label: 'Into Stock', section: 'pending_inventory', action: 'view' },
      { group: 'Production', to: '/carret/produce/parts', label: 'Parts Catalogue', section: 'parts_inventory', action: 'view' },
      { group: 'Production', to: '/carret/stock/part-repairs', label: 'Part Repairs', sections: ['part_vendor_repair', 'parts_procurement', 'parts_inventory', 'inventory_management'], section: 'part_vendor_repair', action: 'view' },
    ],
  },
  {
    key: 'stock',
    label: 'Stock',
    // Stock rebuilt in the new UI (claude/carret-stock.md, 27 Sep 2026). NPA is
    // now "Not earning"; "Scrapped" opened the PARTS scrap challan and is now
    // Scrap (laptop requests, approval, challans). Old screens stay under
    // "Old view" until Stock is signed off (hard rule 6).
    groups: ['Stock', 'Reports & setup'],
    items: [
      { group: 'Stock', to: '/carret/stock/assets', label: 'Assets', section: 'inventory_management', action: 'view' },
      { group: 'Stock', to: '/carret/stock/ready', label: 'Ready Stock', sections: ['inventory_management', 'ready_to_rent_location'], section: 'inventory_management', action: 'view' },
      { group: 'Stock', to: '/carret/stock/with-customers', label: 'With Customers', section: 'customer_assets', action: 'view' },
      { group: 'Stock', to: '/carret/stock/not-earning', label: 'Not Earning', section: 'inventory_management', action: 'view' },
      { group: 'Stock', to: '/carret/stock/scrap', label: 'Scrap', sections: ['inventory_management', 'scrap_approval', 'scrap_challans'], section: 'inventory_management', action: 'view' },
      { group: 'Reports & setup', to: '/carret/stock/master-data', label: 'Master Data', sections: ['inventory_master_data', 'inventory_vendor_master_data', 'inventory_return_master_data'], section: 'inventory_master_data', action: 'view' },
      { group: 'Reports & setup', to: '/carret/stock/asset-configuration', label: 'Asset Configuration', section: 'asset_configuration', action: 'view' },
    ],
  },
  {
    key: 'sell',
    label: 'Sell',
    // Order to delivery is complete in Carret (25 Sep 2026): these open the new
    // screens. The old ones stay under "Old view" until the process is signed
    // off (hard rule 6), then they go.
    groups: ['Leads', 'Order to delivery', 'Customers & more'],
    items: [
      { group: 'Order to delivery', to: '/carret/sell/quotations', label: 'Quotations', section: 'sales_quotations', action: 'view' },
      { group: 'Order to delivery', to: '/carret/sell/sales-orders', label: 'Sales Orders', sections: SO_SECTIONS, section: 'sales_orders_doc', action: 'view' },
      { group: 'Leads', to: '/carret/sell/leads', label: 'Leads', section: 'leads', action: 'view' },
      { group: 'Leads', to: '/carret/sell/follow-ups', label: 'Follow-ups', sections: ['leads', 'lead_follow_ups'], section: 'leads', action: 'view' },
      { group: 'Customers & more', to: '/carret/sell/customers', label: 'Customers', sections: ['customers', 'customer_management'], section: 'customers', action: 'view' },
      { group: 'Customers & more', to: '/carret/sell/demo', label: 'Demo Agreements', section: 'demo_management', action: 'view' },
      { group: 'Customers & more', to: '/carret/sell/sale-in-place', label: 'Sale in Place', section: 'sale_in_place', action: 'view' },
      { group: 'Customers & more', to: '/carret/sell/early-returns', label: 'Early Returns (lock-in)', sections: [...SO_SECTIONS, 'support_tickets', 'customer_billing'], section: 'sales_orders_doc', action: 'view' },
    ],
  },
  {
    key: 'move',
    label: 'Movement',
    // Every challan in the system, grouped by DIRECTION rather than by which
    // module happens to own the document. A challan is a challan: the question
    // on the floor is always "is this going out or coming in", never "which
    // controller wrote it". Each page has ONE place in the menu (2 Oct 2026):
    // vendor return / repair challans and arrivals live in Procurement, scrap
    // challans in Stock, service parts challans in Support, Dispatch QC on the
    // Production floor — they are no longer repeated here.
    groups: ['Outward', 'Inward', 'Gate & tracking'],
    items: [
      // ---- Outward: leaving the warehouse ----
      { group: 'Outward', to: '/carret/move/orders-to-accept', label: 'Orders to accept', section: 'dispatch_pending_orders', action: 'view' },
      { group: 'Outward', to: '/carret/move/challans', label: 'Delivery Challans', section: 'delivery_challans', action: 'view' },
      { group: 'Outward', to: '/carret/move/chargers', label: 'Chargers to hand over', section: 'dispatch_charger_warehouse', action: 'view' },

      // ---- Inward: coming back in ----
      { group: 'Inward', to: '/carret/move/return-challans', label: 'Return Challans', section: 'return_dc', action: 'view' },
      { group: 'Inward', to: '/carret/move/part-inward', label: 'Dead Parts — In & Out', section: 'physical_dead_parts', action: 'view' },

      // ---- Gate & tracking: the crossing itself ----
      { group: 'Gate & tracking', to: '/carret/move/gate', label: 'Guard Gate', section: 'guard_gate_checking', action: 'view' },
      { group: 'Gate & tracking', to: '/carret/move/deliveries', label: 'Delivery Register', sections: ['delivery_register_management', 'technician_bucket'], section: 'delivery_register_management', action: 'view' },
      { group: 'Gate & tracking', to: '/carret/move/my-deliveries', label: 'My Deliveries & Pickups', sections: ['technician_bucket', 'delivery_my_deliveries'], section: 'technician_bucket', action: 'view' },
      { group: 'Gate & tracking', to: '/carret/move/technicians', label: 'Delivery Technicians', section: 'technician_bucket', action: 'view' },
      { group: 'Gate & tracking', to: '/carret/move/tracking', label: 'Courier & Tracking', section: 'bluedart_awb_tracking', action: 'view' },

    ],
  },
  {
    key: 'serve',
    label: 'Support',
    // Support in Carret (claude/carret-support.md, 26 Sep 2026): the lead's desk
    // and the technician's phone open the new screens. The v1 pages stay under
    // "Old view" (pickup / replacement / Service DC / parts still run there)
    // until Support is signed off.
    groups: ['Support desk', 'Technician'],
    items: [
      { group: 'Support desk', to: '/carret/serve/queue', label: 'Queue', section: 'support_tickets', action: 'view' },
      { group: 'Support desk', to: '/carret/serve/requests', label: 'Customer requests', section: 'support_tickets', action: 'view' },
      { group: 'Support desk', to: '/carret/serve/damage', label: 'Damage charges', sections: ['damage_charges', 'support_tickets', 'return_dc', 'customer_billing'], section: 'damage_charges', action: 'view' },
      { group: 'Support desk', to: '/carret/serve/tickets/new', label: 'New ticket', section: 'support_tickets', action: 'create' },
      { group: 'Support desk', to: '/carret/serve/technician-bucket', label: 'Technician bucket', sections: ['technician_bucket', 'support_tickets'], section: 'technician_bucket', action: 'view' },
      { group: 'Support desk', to: '/carret/serve/parts-desk', label: 'Parts desk', section: 'support_part_challan', action: 'view' },
      { group: 'Support desk', to: '/carret/serve/issues', label: 'Issue insights', section: 'support_tickets', action: 'view' },
      { group: 'Support desk', to: '/carret/serve/insights', label: 'SLA & feedback', section: 'support_tickets', action: 'view' },
      { group: 'Support desk', to: '/carret/serve/settings', label: 'Support settings', sections: ['support_settings', 'support_tickets'], section: 'support_settings', action: 'view' },
      { group: 'Technician', to: '/carret/serve/my-work', label: 'My work', section: 'support_tickets', action: 'view' },
      { group: 'Technician', to: '/carret/serve/my-parts', label: 'My parts', sections: ['support_part_requests', 'support_tickets'], section: 'support_part_requests', action: 'view' },
    ],
  },
  {
    key: 'money',
    label: 'Finance',
    // Finance rebuilt in the new UI (claude/carret-remaining-build.md, 29 Sep 2026).
    // Every entry opens a new-UI page guarded by the section its API enforces;
    // the old /customer-billing, /vendor-billing and /finance screens stay routed.
    groups: ['Customers', 'Payments', 'Vendors', 'GST & e-way', 'Charges'],
    items: [
      { group: 'Customers', to: '/carret/money/invoices', label: 'Customer Invoices', section: 'customer_billing', action: 'view' },
      { group: 'Customers', to: '/carret/money/credit-notes', label: 'Credit Notes', section: 'credit_notes', action: 'view' },
      { group: 'Customers', to: '/carret/money/security-deposits', label: 'Security Deposits', section: 'security_deposits', action: 'view' },
      { group: 'Customers', to: '/carret/money/ageing', label: 'Ageing & Outstanding', section: 'customer_billing', action: 'view' },
      { group: 'Payments', to: '/carret/money/payments', label: 'Payments Received', section: 'customer_billing', action: 'view' },
      { group: 'Payments', to: '/carret/money/vendor-payments', label: 'Payments to Vendors', section: 'vendor_billing_mgmt', action: 'view' },
      { group: 'Vendors', to: '/carret/money/vendor-bills', label: 'Vendor Bills', section: 'vendor_billing_mgmt', action: 'view' },
      { group: 'Vendors', to: '/carret/money/debit-notes', label: 'Debit Notes', section: 'debit_notes', action: 'view' },
      { group: 'GST & e-way', to: '/carret/money/gst/queue', label: 'Invoice & E-way Queue', section: 'einvoice_ewb', action: 'view' },
      { group: 'GST & e-way', to: '/carret/money/gst/eway-bills', label: 'E-way Bills', section: 'einvoice_ewb', action: 'view' },
      { group: 'Charges', to: '/carret/money/support-charges', label: 'Support Charges to Bill', section: 'customer_billing', action: 'view' },
      { group: 'Charges', to: '/carret/money/delivery-charges', label: 'Delivery Charges', section: 'customer_billing', action: 'view' },
      { group: 'Charges', to: '/carret/money/service-billing', label: 'Service Billing (gorefurbo)', section: 'customer_billing', action: 'view' },
    ],
  },
  {
    key: 'control',
    label: 'Control',
    // Control in Carret (27 Sep 2026, step 4): users, roles, the permission
    // matrix, per-user overrides and the audit log. The menu can only test
    // sections, so each link shows on its section grant; the page routes also
    // accept the backend's role lists (CT1). Old screens stay under "Old view"
    // until Control is signed off (hard rule 6).
    groups: ['Overview', 'Access', 'Settings'],
    items: [
      // One Today dashboard (29 Sep) replaces Overview, Operations and the Billing dashboard;
      // the page shows only the tiles each user may see.
      { group: 'Overview', to: '/carret/home', label: 'Today', sections: ['dashboard', 'leads', 'sales_quotations', 'sales_orders_doc', 'sales_orders_sale', 'sales_orders_rental', 'sales_orders_replacement', 'dispatch_pending_orders', 'delivery_challans', 'floor_pipeline', 'floor_tickets', 'inventory_management', 'ready_to_rent_location', 'return_dc', 'support_tickets', 'customer_billing', 'vendor_billing_mgmt', 'credit_notes', 'debit_notes', 'einvoice_ewb'], section: 'dashboard', action: 'view' },
      { group: 'Access', to: '/carret/control/users', label: 'Users', section: 'users', action: 'view' },
      { group: 'Access', to: '/carret/control/roles', label: 'Roles', section: 'roles', action: 'view' },
      { group: 'Access', to: '/carret/control/role-permissions', label: 'Role Permissions', section: 'role_permissions', action: 'view' },
      { group: 'Access', to: '/carret/control/user-permissions', label: 'User Permissions', section: 'user_permissions', action: 'view' },
      { group: 'Access', to: '/carret/control/audit-log', label: 'Audit Log', sections: ['role_permissions', 'user_permissions'], section: 'role_permissions', action: 'view' },
      { group: 'Settings', to: '/carret/control/teams', label: 'Teams', section: 'teams', action: 'view' },
      { group: 'Settings', to: '/carret/control/settings', label: 'Company Settings', section: 'company_settings', action: 'view' },
      { group: 'Settings', to: '/carret/control/reports', label: 'Reports', sections: ['analytics_dashboard', 'report_revenue', 'report_collections', 'report_vendor_spend', 'report_lead_conversion', 'report_salesperson', 'report_sales_order', 'report_inventory', 'report_warehouse_laptops', 'report_laptop', 'production_qc_report', 'qc_management', 'report_support_daily', 'report_inward_outward'], section: 'report_revenue', action: 'view' },
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
  // New-UI create forms and aliases, reached from the buttons on their list pages.
  '/carret/home', '/carret/move/challans/new', '/carret/sell/leads/new', '/carret/sell/quotations/new',
  '/carret/sell/sales-orders/new', '/carret/procure/purchase-orders/new', '/carret/procure/vendors/new',
  '/carret/procure/return-requests/new', '/carret/procure/vendor-returns', '/carret/procure/vendor-repair',
  '/carret/produce/pipeline',

  // "Old view" removed from the new menu (29 Sep 2026) so teams test only the
  // new screens. These old screens stay routed and are reached from the Old UI
  // sidebar (menuConfig.js) until each process is signed off.
  '/customer-management/customers', '/delivery-register-management/technicians', '/dispatch/pending-orders',
  '/guard', '/guard/scanner', '/tickets', '/lead-crm/*',
  '/settings/users', '/settings/roles', '/settings/role-permissions', '/settings/user-permissions', '/settings/role-reference',
  '/customer-inventory', '/floor-pipeline/*',

  // Old screens whose work moved to new-UI pages in the remaining build (29 Sep 2026):
  // Finance, dashboards, vendor documents, parts, reports, teams, settings. Still
  // routed and reached from the Old UI sidebar until signed off.
  '/asset-configuration', '/finance/dc-invoice', '/finance/sale-invoice-queue', '/finance/einvoice-queue',
  '/finance/*', '/sales-pipeline/demo', '/reports/*', '/dashboard', '/sales-pipeline/*', '/settings/companies',
  '/support/*', '/support-parts/*', '/teams', '/vendor-management/*', '/inventory-management/*',
  // New-UI aliases and create forms reached from their list pages.
  '/carret', '/carret/money/credit-notes/new', '/carret/procure/repairs/new', '/carret/sell/sale-in-place/new',

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
