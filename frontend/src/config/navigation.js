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
 * Serve · Money · Control. Decision 7 wrote this one as the verb "Produce" to
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
    label: 'Procure',
    // Procure to stock is complete in Carret (26 Sep 2026): these open the new
    // screens, in the order the process runs. The old ones stay under "Old
    // view" until the process is signed off (hard rule 6). Three old links
    // (/grn, /vendor-return, /vendor-repair) pointed at routes that do not
    // exist and are gone (B26).
    groups: ['Procure to stock', 'Old view'],
    items: [
      { group: 'Procure to stock', to: '/carret/procure/to-buy', label: 'To buy', section: 'vendor_management', action: 'view' },
      { group: 'Procure to stock', to: '/carret/procure/purchase-orders', label: 'Purchase Orders', section: 'vendor_management', action: 'view' },
      { group: 'Procure to stock', to: '/carret/procure/spare-parts-orders', label: 'Spare-parts Orders', sections: ['vendor_management', 'parts_procurement'], section: 'vendor_management', action: 'view' },
      { group: 'Procure to stock', to: '/carret/procure/arrivals', label: 'Vendor Arrivals', sections: ['guard_gate_checking', 'vendor_management'], section: 'vendor_management', action: 'view' },
      { group: 'Procure to stock', to: '/carret/procure/returns', label: 'Vendor Returns', sections: ['vendor_return_to_vendor', 'vendor_management', 'vendor_repair_dc', 'vendor_return_ticket'], section: 'vendor_return_to_vendor', action: 'view' },
      { group: 'Procure to stock', to: '/carret/procure/vendors', label: 'Vendors', section: 'vendor_management', action: 'view' },
      { group: 'Procure to stock', to: '/carret/procure/vendor-rentals', label: 'Vendor Rentals', sections: ['vendor_management', 'vendor_billing_mgmt', 'vendor_repair_dc'], section: 'vendor_management', action: 'view' },
      { group: 'Procure to stock', to: '/carret/procure/replacement-approvals', label: 'Replacement Approvals', sections: ['vendor_repair_dc', 'vendor_management', 'vendor_billing_mgmt'], section: 'vendor_repair_dc', action: 'view' },
      { group: 'Old view', to: '/vendor-management/purchase-orders', label: 'Purchase Orders (old)', section: 'vendor_management', action: 'view' },
      { group: 'Old view', to: '/vendor-management/spare-parts-po', label: 'Spare Parts PO (old)', section: 'parts_procurement', action: 'view' },
      { group: 'Old view', to: '/vendor-management/vendors', label: 'Vendors (old)', section: 'vendor_management', action: 'view' },
      { group: 'Old view', to: '/vendor-management/return-to-vendor', label: 'Return to Vendor (old)', section: 'vendor_return_to_vendor', action: 'view' },
      { group: 'Old view', to: '/vendor-management/return-ticket', label: 'Vendor Return Tickets (old)', section: 'vendor_return_ticket', action: 'view' },
      { group: 'Old view', to: '/vendor-management/vendor-repair-dc', label: 'Vendor Repair DCs (old)', section: 'vendor_repair_dc', action: 'view' },
    ],
  },
  {
    key: 'produce',
    label: 'Production',
    // Production in Carret (26 Sep 2026): the floor board, a laptop's ticket,
    // the parts desk and into-stock. The old screens stay under "Old view"
    // until the process is signed off (hard rule 6).
    groups: ['Production', 'Old view'],
    items: [
      { group: 'Production', to: '/carret/produce/floor', label: 'Floor', sections: ['floor_pipeline', 'floor_tickets'], section: 'floor_pipeline', action: 'view' },
      { group: 'Production', to: '/carret/produce/parts-desk', label: 'Parts Desk', sections: ['parts_approval', 'parts_inventory'], section: 'parts_approval', action: 'view' },
      { group: 'Production', to: '/carret/produce/into-stock', label: 'Into Stock', section: 'pending_inventory', action: 'view' },
      { group: 'Production', to: '/carret/produce/parts', label: 'Parts Stock', section: 'parts_inventory', action: 'view' },
      { group: 'Production', to: '/inventory-management/part-vendor-repair', label: 'Part Repairs', section: 'part_vendor_repair', action: 'view' },
      { group: 'Old view', to: '/floor-pipeline/tickets', label: 'Floor Pipeline (old)', section: 'floor_pipeline', action: 'view' },
      { group: 'Old view', to: '/floor-pipeline/pending-inventory', label: 'Pending Inventory (old)', section: 'pending_inventory', action: 'view' },
      { group: 'Old view', to: '/inventory-management/parts-approval', label: 'Parts Approval (old)', section: 'parts_approval', action: 'view' },
      { group: 'Old view', to: '/qc-management/orders', label: 'QC Management (old)', section: 'qc_management', action: 'view' },
      { group: 'Old view', to: '/inventory-management/parts', label: 'Parts (old)', section: 'parts_inventory', action: 'view' },
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
    // Order to delivery is complete in Carret (25 Sep 2026): these open the new
    // screens. The old ones stay under "Old view" until the process is signed
    // off (hard rule 6), then they go.
    groups: ['Order to delivery', 'Customers & more', 'Old view'],
    items: [
      { group: 'Order to delivery', to: '/carret/sell/quotations', label: 'Quotations', section: 'sales_quotations', action: 'view' },
      { group: 'Order to delivery', to: '/carret/sell/sales-orders', label: 'Sales Orders', sections: SO_SECTIONS, section: 'sales_orders_doc', action: 'view' },
      { group: 'Customers & more', to: '/lead-crm/leads', label: 'Leads', section: 'leads', action: 'view' },
      { group: 'Customers & more', to: '/lead-crm/follow-ups', label: 'Follow-ups', section: 'lead_follow_ups', action: 'view' },
      { group: 'Customers & more', to: '/customer-management/customers', label: 'Customers', section: 'customer_management', action: 'view' },
      { group: 'Customers & more', to: '/carret/sell/customers', label: 'Customers (list)', section: 'customer_management', action: 'view' },
      { group: 'Customers & more', to: '/sales-pipeline/demo', label: 'Demo Agreements', section: 'demo_management', action: 'view' },
      { group: 'Customers & more', to: '/sales-pipeline/sale-in-place', label: 'Sale in Place', section: 'sale_in_place', action: 'view' },
      { group: 'Old view', to: '/sales-pipeline/quotations', label: 'Quotations (old)', section: 'sales_quotations', action: 'view' },
      { group: 'Old view', to: '/sales-pipeline/sales-orders', label: 'Sales Orders (old)', sections: SO_SECTIONS, section: 'sales_orders_doc', action: 'view' },
    ],
  },
  {
    key: 'move',
    label: 'Move',
    // Every challan in the system, grouped by DIRECTION rather than by which
    // module happens to own the document. A challan is a challan: the question
    // on the floor is always "is this going out or coming in", never "which
    // controller wrote it". The four families that live in other sections
    // (vendor return, vendor repair, scrap, service parts) are linked here as
    // well as there — one document, two ways to reach it, no second flow.
    groups: ['Outward', 'Inward', 'Gate & tracking', 'Old view'],
    items: [
      // ---- Outward: leaving the warehouse ----
      { group: 'Outward', to: '/carret/move/challans', label: 'Delivery Challans', section: 'delivery_challans', action: 'view' },
      { group: 'Outward', to: '/vendor-management/return-to-vendor', label: 'Vendor Return DC', section: 'vendor_return_to_vendor', action: 'view' },
      { group: 'Outward', to: '/vendor-management/vendor-repair-dc', label: 'Vendor Repair DC', section: 'vendor_repair_dc', action: 'view' },
      { group: 'Outward', to: '/inventory-management/scrap-challans', label: 'Scrap Challans', section: 'scrap_challans', action: 'view' },
      { group: 'Outward', to: '/support-parts/queue', label: 'Service Parts Challans', section: 'support_part_challan', action: 'view' },
      { group: 'Outward', to: '/inventory-management/dispatch-chargers', label: 'Dispatch Chargers', section: 'dispatch_charger', action: 'view' },

      // ---- Inward: coming back in ----
      { group: 'Inward', to: '/carret/procure/arrivals', label: 'Vendor Arrivals', sections: ['guard_gate_checking', 'vendor_management'], section: 'vendor_management', action: 'view' },
      { group: 'Inward', to: '/sales-pipeline/return-dc', label: 'Return Challans', section: 'return_dc', action: 'view' },
      { group: 'Inward', to: '/carret/move/return-challans', label: 'Return Challans (Carret)', section: 'return_dc', action: 'view' },
      { group: 'Inward', to: '/vendor-management/vendor-repair-dc?direction=inward', label: 'Vendor Repair Receive', section: 'vendor_repair_dc', action: 'view' },
      { group: 'Inward', to: '/vendor-management/return-ticket', label: 'Vendor Return Ticket', section: 'vendor_return_ticket', action: 'view' },
      { group: 'Inward', to: '/inventory-management/physical-part-inward', label: 'Part Inward', section: 'parts_inventory', action: 'view' },

      // ---- Gate & tracking: the crossing itself ----
      { group: 'Gate & tracking', to: '/carret/move/gate', label: 'Guard Gate', section: 'guard_gate_checking', action: 'view' },
      { group: 'Gate & tracking', to: '/floor-pipeline/tickets?stage=Dispatch%20QC', label: 'Dispatch QC', section: 'dispatch_qc', action: 'view' },
      { group: 'Gate & tracking', to: '/carret/move/deliveries', label: 'Delivery Register', sections: ['delivery_register_management', 'technician_bucket'], section: 'delivery_register_management', action: 'view' },
      { group: 'Gate & tracking', to: '/carret/move/my-deliveries', label: 'My Deliveries', sections: ['technician_bucket', 'delivery_my_deliveries'], section: 'technician_bucket', action: 'view' },
      { group: 'Gate & tracking', to: '/delivery-register-management/technicians', label: 'Delivery Technicians', section: 'delivery_register_management', action: 'view' },
      { group: 'Gate & tracking', to: '/carret/move/tracking', label: 'Courier & Tracking', section: 'bluedart_awb_tracking', action: 'view' },
      { group: 'Gate & tracking', to: '/dispatch/pending-orders', label: 'Pending Dispatch', section: 'dispatch_pending_orders', action: 'view' },

      // ---- Old view: kept until Order to delivery is signed off ----
      { group: 'Old view', to: '/sales-pipeline/delivery-challans', label: 'Delivery Challans (old)', section: 'delivery_challans', action: 'view' },
      { group: 'Old view', to: '/guard', label: 'Guard Gate (old)', section: 'guard_gate_checking', action: 'view' },
      { group: 'Old view', to: '/guard/scanner', label: 'Gate Scanner (old)', section: 'gate_dashboard', action: 'view' },
      { group: 'Old view', to: '/sales-pipeline/delivery-register', label: 'Delivery Register (old)', section: 'delivery_register_management', action: 'view' },
      { group: 'Old view', to: '/sales-pipeline/my-deliveries', label: 'My Deliveries (old)', section: 'technician_bucket', action: 'view' },
      { group: 'Old view', to: '/sales-pipeline/bluedart-tracking', label: 'Courier & Tracking (old)', section: 'bluedart_awb_tracking', action: 'view' },
    ],
  },
  {
    key: 'serve',
    label: 'Serve',
    // Support in Carret (claude/carret-support.md, 26 Sep 2026): the lead's desk
    // and the technician's phone open the new screens. The v1 pages stay under
    // "Old view" (pickup / replacement / Service DC / parts still run there)
    // until Support is signed off.
    groups: ['Support desk', 'Technician', 'Old view'],
    items: [
      { group: 'Support desk', to: '/carret/serve/queue', label: 'Queue', section: 'support_tickets', action: 'view' },
      { group: 'Support desk', to: '/carret/serve/tickets/new', label: 'New ticket', section: 'support_tickets', action: 'create' },
      { group: 'Support desk', to: '/carret/serve/parts-desk', label: 'Parts desk', section: 'support_part_challan', action: 'view' },
      { group: 'Support desk', to: '/carret/serve/insights', label: 'SLA & feedback', section: 'support_tickets', action: 'view' },
      { group: 'Support desk', to: '/support/requests', label: 'Customer requests', section: 'support_tickets', action: 'view' },
      { group: 'Technician', to: '/carret/serve/my-work', label: 'My work', section: 'support_tickets', action: 'view' },
      { group: 'Technician', to: '/carret/serve/my-parts', label: 'My parts', sections: ['support_part_requests', 'support_tickets'], section: 'support_part_requests', action: 'view' },
      { group: 'Technician', to: '/carret/move/my-deliveries', label: 'My deliveries', sections: ['technician_bucket', 'delivery_my_deliveries'], section: 'technician_bucket', action: 'view' },
      { group: 'Old view', to: '/support/tickets', label: 'Support Queue (old)', section: 'support_tickets', action: 'view' },
      { group: 'Old view', to: '/support/parts-queue', label: 'Parts Requests', section: 'support_part_requests', action: 'view' },
      { group: 'Old view', to: '/support-parts/queue', label: 'Parts Challans', section: 'support_part_challan', action: 'view' },
      { group: 'Old view', to: '/support/tech-bucket', label: 'Technician Bucket', section: 'technician_bucket', action: 'view' },
      { group: 'Old view', to: '/support/technicians', label: 'Technicians', section: 'support_technician', action: 'view' },
      { group: 'Old view', to: '/support/settings', label: 'Support Settings', section: 'support_settings', action: 'view' },
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
      // Part 6.4, behind REACT_APP_CARRET. Beside the existing screens (hard
      // rule 6). Ageing & Outstanding has no old counterpart at all — neither
      // the buckets nor the due dates they rest on existed before Part 6.2.
      { to: '/carret/money/invoices', label: 'Customer Invoices (Carret)', section: 'customer_billing', action: 'view' },
      { to: '/carret/money/ageing', label: 'Ageing & Outstanding (Carret)', section: 'customer_billing', action: 'view' },
      { to: '/carret/money/support-charges', label: 'Support Charges to Bill', section: 'customer_billing', action: 'view' },
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
