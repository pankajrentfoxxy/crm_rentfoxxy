/**
 * Permission section catalogue — the single backend source for section groups,
 * labels, aliases and which scope selectors apply to which section.
 *
 * permission_sections (the DB table) holds the rows; migration 360 adds
 * `section_group` and `hidden` to it and fills them from this file. The API
 * (GET /api/roles/sections) prefers the DB values and falls back to this file,
 * so the matrix renders correctly whether or not 360 has been applied yet.
 *
 * "hidden" = kept in the DB (role rows may reference it) but not rendered in
 * the matrix by default: either enforced nowhere in the code (the Support v2
 * sections from migration 301, catalogue/invoices/orders from 040, …) or a
 * legacy umbrella that is only reached through an alias (sales_orders,
 * reports, …). Nothing is deleted.
 */

/**
 * Permission resolution aliases: a grant on any listed section satisfies a
 * check on the key. Used by permissionService.hasPermission.
 */
/**
 * Duplicate sections merged on 2 Oct 2026 (migration 411): old -> kept. The old
 * name's grants were copied onto the kept one and removed; the old name is
 * hidden from the matrix and every check on it resolves to the kept section
 * (SECTION_ALIASES below), so old screens keep working on the kept grant.
 * delivery_technicians / delivery_my_deliveries are not aliased: only
 * super_admin held them, and their checks were moved to technician_bucket
 * (aliasing would have handed the charger scan to every bucket holder).
 */
const MERGED_SECTIONS = Object.freeze({
  customer_management: 'customers',
  customer_inventory: 'customer_assets',
  follow_ups: 'lead_follow_ups',
  delivery_technicians: 'technician_bucket',
  delivery_my_deliveries: 'technician_bucket',
  tickets: 'floor_tickets',
  procurement: 'vendor_management',
  inventory: 'inventory_management',
});

const SECTION_ALIASES = Object.freeze({
  customer_management: ['customer_management', 'customers'],
  customer_inventory: ['customer_inventory', 'customer_assets'],
  procurement: ['procurement', 'vendor_management'],
  inventory: ['inventory', 'inventory_management'],
  reports_access: ['reports_access', 'reports'],
  reports: ['reports', 'reports_access'],
  follow_ups: ['follow_ups', 'lead_follow_ups'],
  lead_follow_ups: ['follow_ups', 'lead_follow_ups'],
  sales_orders: ['sales_orders', 'sales_orders_doc'],
  sales_orders_doc: ['sales_orders', 'sales_orders_doc', 'sales_orders_sale', 'sales_orders_rental'],
  sales_orders_sale: ['sales_orders_sale', 'sales_orders_doc', 'sales_orders'],
  sales_orders_rental: ['sales_orders_rental', 'sales_orders_doc', 'sales_orders'],
  vendor_repair_dc: ['vendor_repair_dc', 'vendor_repair_dc_dispatch'],
  sales_orders_replacement: ['sales_orders_replacement'],
  replacement_so_laptop_qc: ['replacement_so_laptop_qc'],
  so_laptop_qc: ['so_laptop_qc'],
  sales_order_cancel: ['sales_order_cancel'],
  tickets: ['tickets', 'floor_tickets'],
});

/**
 * Data-scope aliases (dataScopeService): the permission aliases minus the
 * vendor-repair pair (data scope never applied there), plus the floor / QC /
 * dispatch families that share one "All data / Assigned" setting.
 * Kept byte-for-byte equivalent to the map dataScopeService used before.
 */
const DATA_SCOPE_SECTION_ALIASES = Object.freeze({
  reports_access: SECTION_ALIASES.reports_access,
  reports: SECTION_ALIASES.reports,
  follow_ups: SECTION_ALIASES.follow_ups,
  lead_follow_ups: SECTION_ALIASES.lead_follow_ups,
  sales_orders: SECTION_ALIASES.sales_orders,
  sales_orders_doc: SECTION_ALIASES.sales_orders_doc,
  sales_orders_sale: SECTION_ALIASES.sales_orders_sale,
  sales_orders_rental: SECTION_ALIASES.sales_orders_rental,
  floor_pipeline: ['floor_pipeline', 'floor_tickets', 'tickets'],
  floor_tickets: ['floor_tickets', 'floor_pipeline', 'tickets'],
  tickets: ['tickets', 'floor_pipeline', 'floor_tickets'],
  // Include floor_tickets so a user override of All Data on Floor Tickets
  // is visible when resolving chip/floor list scope (not only floor_pipeline/tickets).
  chip_level_repair: ['chip_level_repair', 'floor_pipeline', 'floor_tickets', 'tickets'],
  qc_management: ['qc_management', 'tickets'],
  dispatch: ['dispatch', 'delivery_challans'],
  delivery_challans: ['delivery_challans', 'dispatch'],
});

/** Sections whose `data_scope` (All data / Assigned) is read by dataScopeService. */
const DATA_SCOPE_SECTIONS = Object.freeze([
  'leads', 'lead_orders', 'follow_ups', 'lead_follow_ups',
  'sales_orders_doc', 'sales_orders_sale', 'sales_orders_rental', 'sales_orders_replacement',
  'delivery_challans', 'dispatch', 'return_dc', 'support_tickets',
  'tickets', 'floor_pipeline', 'floor_tickets', 'chip_level_repair', 'qc_management',
]);

/** Sections whose `customer_access` (all / sales / rental) is read by customerAccessScope. */
const CUSTOMER_ACCESS_SECTIONS = Object.freeze(['customers', 'customer_management']);

/** Sections whose `inventory_tag_access` is read by inventoryTagAccessScope. */
const INVENTORY_TAG_SECTIONS = Object.freeze(['inventory_management', 'inventory']);

const DATA_SCOPE_VALUES = Object.freeze(['all', 'assigned']);
const CUSTOMER_ACCESS_VALUES = Object.freeze(['all', 'sales', 'rental']);
const INVENTORY_TAG_ACCESS_VALUES = Object.freeze([
  'all', 'rental_only', 'rental_both', 'sale_only', 'sale_both', 'sales', 'rental',
]);

const SCOPE_VALUE_OPTIONS = Object.freeze({
  data_scope: [
    { value: 'all', label: 'All data' },
    { value: 'assigned', label: 'Assigned only' },
  ],
  customer_access: [
    { value: 'all', label: 'All customers' },
    { value: 'sales', label: 'Sales customers' },
    { value: 'rental', label: 'Rental customers' },
  ],
  inventory_tag_access: [
    { value: 'all', label: 'All stock' },
    { value: 'rental_only', label: 'Rental only' },
    { value: 'rental_both', label: 'Rental + Both' },
    { value: 'sale_only', label: 'Sale only' },
    { value: 'sale_both', label: 'Sale + Both' },
  ],
});

/** Ordered groups for the matrix. Every visible section appears in exactly one. */
const SECTION_GROUPS = Object.freeze([
  { key: 'core', label: 'Core', sections: ['dashboard', 'taskflow'] },
  {
    key: 'sales',
    label: 'Lead & Sales CRM',
    sections: [
      'leads', 'lead_assignee_change', 'lead_follow_ups', 'lead_conversion', 'lead_orders',
      'customers', 'customer_documents', 'kyc_management', 'demo_management',
      'sales_quotations', 'sales_orders_sale', 'sales_orders_rental', 'sales_orders_replacement',
      'replacement_so_laptop_qc', 'so_laptop_qc', 'so_line_rate_config_edit', 'sales_order_cancel',
      'delivery_challans', 'bluedart_awb_tracking', 'return_dc',
      'delivery_register_management', 'delivery_register_otp', 'technician_bucket',
      'technicians_bucket_list', 'payment_records',
    ],
  },
  {
    key: 'vendor',
    label: 'Vendor & Procurement',
    sections: [
      'vendor_management', 'vendor_repair_dc', 'vendor_repair_dc_dispatch', 'vendor_return_to_vendor',
      'vendor_return_ticket', 'sales_pipeline',
    ],
  },
  {
    key: 'master',
    label: 'Master Data',
    sections: ['inventory_master_data', 'inventory_vendor_master_data', 'inventory_return_master_data'],
  },
  {
    key: 'floor',
    label: 'Floor & Quality',
    sections: [
      'floor_pipeline', 'floor_tickets', 'floor_ticket_config_edit', 'chip_level_repair', 'qc_management',
      'dispatch_qc', 'dispatch_charger', 'pending_inventory', 'diagnosis_failed',
    ],
  },
  {
    key: 'inventory',
    label: 'Inventory',
    sections: [
      'inventory_management', 'inventory_asset_movement', 'qc_move_to_ticket',
      'qc_create_production_ticket', 'ready_to_rent_location', 'customer_assets',
      'ttspl_history',
    ],
  },
  {
    key: 'parts',
    label: 'Part Management',
    sections: [
      'parts_dashboard', 'parts_inventory', 'parts_approval', 'dispatch_charger_warehouse',
      'parts_approval_export', 'parts_history', 'parts_procurement', 'part_vendor_repair', 'parts_discarded',
      'physical_dead_parts', 'scrap_challans', 'scrap_approval', 'parts_detach', 'parts_requests',
      'support_part_challan', 'support_part_requests', 'parts',
    ],
  },
  { key: 'gate', label: 'Warehouse Gate', sections: ['guard_gate_checking', 'gate_dashboard'] },
  {
    key: 'dispatch',
    label: 'Warehouse & Dispatch',
    sections: ['warehouse', 'dispatch', 'dispatch_ops', 'dispatch_workflow', 'dispatch_pending_orders'],
  },
  {
    key: 'finance',
    label: 'Finance & Billing',
    sections: [
      'customer_billing', 'vendor_billing_mgmt', 'credit_notes', 'debit_notes', 'security_deposits',
      'billing_dashboard', 'einvoice_ewb', 'dc_eway_bill', 'sale_in_place',
    ],
  },
  {
    key: 'support',
    label: 'Support',
    sections: ['support_tickets', 'support_requests', 'support_settings', 'support_technician'],
  },
  {
    key: 'reports',
    label: 'Reports & Analytics',
    sections: [
      'analytics_dashboard', 'report_revenue', 'report_inventory', 'report_lead_conversion',
      'report_salesperson', 'report_collections', 'report_vendor_spend', 'report_laptop',
      'report_warehouse_laptops', 'report_sales_order', 'report_support_daily', 'report_inward_outward',
      'production_qc_report', 'reports_export',
    ],
  },
  {
    key: 'admin',
    label: 'Settings & Admin',
    sections: ['users', 'teams', 'roles', 'role_permissions', 'user_permissions', 'company_settings', 'asset_configuration'],
  },
]);

const HIDDEN_GROUP = Object.freeze({ key: '_hidden', label: 'Hidden (not enforced / legacy)' });

/**
 * In the catalogue but not rendered by default. Not deleted — role rows may
 * still reference them and a later build may enforce them.
 */
const HIDDEN_SECTIONS = Object.freeze([
  // Legacy umbrellas, reached only through SECTION_ALIASES.
  'sales_orders', 'sales_orders_doc', 'reports', 'reports_access', 'manager_dashboard',
  // Enforced nowhere in backend or frontend (checked 27 Sep 2026).
  'catalogue', 'invoices', 'orders', 'permissions', 'operation_management', 'parts_pricing', 'qc_add_laptop',
  // Support v2 (migration 301 / 321 / 323) — seeded, never enforced.
  'support_dashboard', 'support_triage', 'support_work_orders', 'support_pickup_repair',
  'support_pickup_return', 'support_replacement', 'support_field_visit', 'support_parts_request',
  'support_parts_approve', 'support_charges', 'support_approvals', 'support_dispatch', 'support_bucket',
  'support_groups', 'support_customer_portal', 'support_reports', 'support_sla_admin', 'support_taxonomy',
  'support_charges_billing', 'support_warehouse_receipt',
  // Merged into another section (MERGED_SECTIONS, 2 Oct 2026).
  'customer_management', 'customer_inventory', 'follow_ups', 'delivery_technicians',
  'delivery_my_deliveries', 'tickets', 'procurement', 'inventory',
]);

const SECTION_LABELS = Object.freeze({
  dashboard: 'Dashboard',
  taskflow: 'TaskFlow',
  analytics_dashboard: 'Analytics Dashboards (Manager & Sales)',
  leads: 'Leads',
  lead_assignee_change: 'Lead Assignee Change (Sales team)',
  lead_follow_ups: 'Follow-ups',
  follow_ups: 'Follow-ups (list scope)',
  lead_conversion: 'Lead Conversion',
  lead_orders: 'Lead Orders',
  customers: 'Customers',
  customer_management: 'Customer Management',
  customer_documents: 'Customer Documents',
  kyc_management: 'KYC',
  demo_management: 'Demos',
  sales_quotations: 'Quotations',
  sales_orders_doc: 'Sales Orders (legacy)',
  sales_orders_sale: 'Sales Order – Sale',
  sales_orders_rental: 'Sales Order – Rental',
  sales_orders_replacement: 'Sales Orders – Replacement',
  replacement_so_laptop_qc: 'Replacement SO — Laptop & QC',
  so_laptop_qc: 'Sales SO — Laptops & QC (Rental/Sale)',
  so_line_rate_config_edit: 'Sales SO — Edit line rate / config',
  sales_order_cancel: 'Sales Order — Partial cancel (Rental/Sale)',
  delivery_challans: 'Delivery Challans',
  bluedart_awb_tracking: 'BlueDart AWB Tracking',
  return_dc: 'Return DC',
  delivery_register_management: 'Delivery Register',
  delivery_register_otp: 'Delivery Register — View OTP',
  technician_bucket: 'Delivery Technician',
  delivery_technicians: 'Delivery Technicians',
  delivery_my_deliveries: 'My Deliveries',
  support_technician: 'Support Technician (Field)',
  technicians_bucket_list: 'Technicians Bucket (Admin)',
  payment_records: 'Payment Records',
  vendor_management: 'Vendor Management',
  vendor_repair_dc: 'Vendor Repair DC (Laptops)',
  vendor_repair_dc_dispatch: 'Vendor Repair DC — Sign, Dispatch & Delivery',
  vendor_return_to_vendor: 'Return to Vendor',
  vendor_return_ticket: 'Vendor Return Tickets',
  procurement: 'Procurement',
  sales_pipeline: 'Sales Pipeline',
  floor_pipeline: 'Floor Pipeline',
  floor_tickets: 'Floor Tickets',
  floor_ticket_config_edit: 'Floor Tickets — Edit Config',
  chip_level_repair: 'Chip Level Repair',
  qc_management: 'QC Management',
  dispatch_qc: 'Dispatch QC',
  pending_inventory: 'QC Ready',
  diagnosis_failed: 'Diagnosis Failed — Out for Repair',
  tickets: 'Tickets (Legacy)',
  inventory: 'Inventory',
  inventory_management: 'Inventory Management',
  inventory_master_data: 'Master Data Dashboard',
  inventory_vendor_master_data: 'Master Vendor Data',
  inventory_return_master_data: 'Master Return Data',
  inventory_asset_movement: 'Inventory — Asset Movement',
  qc_add_laptop: 'QC Process — add new laptop',
  qc_move_to_ticket: 'QC Pending / Dead — move to QC Process + ticket',
  qc_create_production_ticket: 'QC Process — Create Production Ticket',
  ready_to_rent_location: 'Ready to Rent/Sell — change location',
  dispatch_charger: 'Dispatch QC — attach charger',
  dispatch_charger_warehouse: 'Warehouse — dispatch charger handover',
  parts: 'Parts (Legacy)',
  parts_dashboard: 'Parts Dashboard',
  parts_inventory: 'Parts Inventory',
  parts_approval: 'Parts Approval',
  parts_approval_export: 'Parts Approval — Export CSV',
  parts_history: 'Parts Movement History',
  parts_procurement: 'Spare Parts PO',
  part_vendor_repair: 'Part Vendor Repair DC',
  parts_discarded: 'Discarded Parts',
  physical_dead_parts: 'Dead / Physical Parts',
  scrap_challans: 'Scrap Challans',
  scrap_approval: 'Approve Laptop Scrap',
  parts_detach: 'Part Detach (Attached → Inventory)',
  parts_requests: 'Part Requests (Floor)',
  support_part_challan: 'Support Part Queue',
  support_part_requests: 'Technician Parts Bucket',
  customer_inventory: 'Customer Inventory',
  customer_assets: 'Customer Assets — With Customers list, edit rate / export',
  dispatch_workflow: 'Dispatch Workflow',
  dispatch_pending_orders: 'Dispatch Pending Orders',
  ttspl_history: 'TTSPL History',
  warehouse: 'Warehouse',
  dispatch: 'Dispatch',
  dispatch_ops: 'Dispatch Operations',
  customer_billing: 'Customer Billing',
  vendor_billing_mgmt: 'Vendor Billing',
  credit_notes: 'Credit Notes',
  debit_notes: 'Debit Notes',
  security_deposits: 'Security Deposits',
  billing_dashboard: 'Billing Dashboard',
  einvoice_ewb: 'E-Invoice & E-Way Bill',
  dc_eway_bill: 'DC E-Way Bill Management',
  sale_in_place: 'Lost / Buyout Sale (stop rent + sale order)',
  support_tickets: 'Support Tickets',
  support_requests: 'Support Requests (QR)',
  support_settings: 'Support Settings',
  reports: 'Reports (legacy)',
  reports_access: 'Reports Access (legacy)',
  reports_export: 'Export Reports',
  report_revenue: 'Report — Revenue',
  report_inventory: 'Report — Inventory Utilisation',
  report_lead_conversion: 'Report — Lead Conversion',
  report_salesperson: 'Report — Salesperson',
  report_collections: 'Report — Collections',
  report_vendor_spend: 'Report — Vendor Spend',
  report_laptop: 'Report — Technician / Laptop',
  report_warehouse_laptops: 'Report — Warehouse Laptops',
  report_sales_order: 'Report — Sales Order',
  report_support_daily: 'Report — Daily Support Summary',
  report_inward_outward: 'Report — Inward & Outward Summary',
  production_qc_report: 'Report — Production QC',
  manager_dashboard: 'Manager Dashboard (legacy)',
  users: 'User Management',
  teams: 'Team Management',
  roles: 'Role Management',
  role_permissions: 'Role Permissions',
  user_permissions: 'User Permissions',
  company_settings: 'Company Settings',
  asset_configuration: 'Asset Configuration',
  guard_gate_checking: 'Guard Scanner',
  gate_dashboard: 'Gate Dashboard',
});

const SECTION_TO_GROUP = Object.freeze(
  SECTION_GROUPS.reduce((acc, g) => {
    g.sections.forEach((s) => { acc[s] = g.key; });
    return acc;
  }, {})
);

const HIDDEN_SET = new Set(HIDDEN_SECTIONS);

/** Every section this file knows about (visible + hidden). */
const KNOWN_SECTIONS = Object.freeze([
  ...new Set([...SECTION_GROUPS.flatMap((g) => g.sections), ...HIDDEN_SECTIONS]),
]);

function sectionScopes(section) {
  return {
    data_scope: DATA_SCOPE_SECTIONS.includes(section),
    customer_access: CUSTOMER_ACCESS_SECTIONS.includes(section),
    inventory_tag_access: INVENTORY_TAG_SECTIONS.includes(section),
  };
}

function humanize(section) {
  return String(section || '')
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Merge DB rows of permission_sections with this file into the API catalogue.
 * DB `section_group` / `hidden` win when present (migration 360); otherwise
 * this file decides. Sections known here but missing from the DB are included
 * with in_catalogue=false so every enforced section is grantable (the upsert
 * accepts them — see isKnownSection).
 * Pure; unit-tested.
 */
function buildCatalogue(dbRows = []) {
  const byKey = new Map();
  for (const row of dbRows || []) {
    if (!row?.section) continue;
    byKey.set(row.section, row);
  }
  const keys = new Set([...byKey.keys(), ...KNOWN_SECTIONS]);
  const groupKeys = new Set(SECTION_GROUPS.map((g) => g.key));
  const sections = [];
  for (const section of keys) {
    const row = byKey.get(section) || null;
    const dbGroup = row?.section_group && groupKeys.has(row.section_group) ? row.section_group : null;
    const hidden = typeof row?.hidden === 'boolean' ? row.hidden : HIDDEN_SET.has(section);
    const group = hidden ? HIDDEN_GROUP.key : (dbGroup || SECTION_TO_GROUP[section] || 'other');
    sections.push({
      section,
      label: SECTION_LABELS[section] || row?.description || humanize(section),
      description: row?.description || null,
      sort_order: row?.sort_order ?? null,
      group,
      hidden,
      in_catalogue: !!row,
      scopes: sectionScopes(section),
    });
  }

  const order = new Map();
  SECTION_GROUPS.forEach((g, gi) => g.sections.forEach((s, si) => order.set(s, gi * 1000 + si)));
  sections.sort((a, b) => {
    const oa = order.has(a.section) ? order.get(a.section) : 1e6 + (a.sort_order ?? 0);
    const ob = order.has(b.section) ? order.get(b.section) : 1e6 + (b.sort_order ?? 0);
    return oa - ob || a.section.localeCompare(b.section);
  });

  const groups = [];
  for (const g of [...SECTION_GROUPS, { key: 'other', label: 'Other' }, HIDDEN_GROUP]) {
    const members = sections.filter((s) => s.group === g.key).map((s) => s.section);
    if (members.length) groups.push({ key: g.key, label: g.label, sections: members });
  }
  return { sections, groups };
}

module.exports = {
  MERGED_SECTIONS,
  SECTION_ALIASES,
  DATA_SCOPE_SECTION_ALIASES,
  DATA_SCOPE_SECTIONS,
  CUSTOMER_ACCESS_SECTIONS,
  INVENTORY_TAG_SECTIONS,
  DATA_SCOPE_VALUES,
  CUSTOMER_ACCESS_VALUES,
  INVENTORY_TAG_ACCESS_VALUES,
  SCOPE_VALUE_OPTIONS,
  SECTION_GROUPS,
  HIDDEN_GROUP,
  HIDDEN_SECTIONS,
  SECTION_LABELS,
  SECTION_TO_GROUP,
  KNOWN_SECTIONS,
  sectionScopes,
  buildCatalogue,
};
