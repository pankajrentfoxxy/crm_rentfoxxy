#!/usr/bin/env node
/**
 * Generate migration documentation from _schema_extract.json
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const EXTRACT = path.join(ROOT, 'migration', '_schema_extract.json');
const OUT = path.join(ROOT, 'migration');

const data = JSON.parse(fs.readFileSync(EXTRACT, 'utf8'));
const erpTables = data.erp.tables;
const crmTables = data.crm.tables;
const erpRows = data.erp.rowEstimates || {};
const crmRows = data.crm.copyCounts || {};

// --- ERP → CRM mapping definitions (derived from schema + Laravel/Node source) ---
const MAPPINGS = {
  // Identity & RBAC
  admin_roles: { crm: null, type: 'Skip', risk: 'None', note: 'PRESERVE CRM roles — see AUTH_TABLES.md' },
  roles: { crm: null, type: 'Skip', risk: 'None', note: 'Legacy ERP roles; CRM RBAC preserved' },
  roles_modules: { crm: null, type: 'Skip', risk: 'None', note: 'CRM permission_sections preserved' },
  role_permissions: { crm: null, type: 'Skip', risk: 'None', note: 'CRM role_permissions preserved' },
  new_modules: { crm: null, type: 'Skip', risk: 'None', note: 'CRM permission_sections preserved' },
  new_user_permissions: { crm: null, type: 'Skip', risk: 'None', note: 'CRM user_permissions preserved' },
  admins: { crm: 'users', type: 'Additive', risk: 'Medium', note: 'Match by email; insert only if missing; never overwrite role/password' },
  users: { crm: null, type: 'Skip', risk: 'Low', note: 'ERP front-end users; not CRM internal users' },
  team_members: { crm: null, type: 'Skip', risk: 'None', note: 'PRESERVE CRM user_teams' },

  // Masters / Config
  brands: { crm: 'asset_config_brands + laptop_catalog', type: 'Additive', risk: 'Low', note: 'Insert missing brands only — preserve CRM asset_config' },
  attributes: { crm: 'asset_config_*', type: 'Additive', risk: 'Low', note: 'Insert missing attribute values only' },
  bundle_management: { crm: 'laptop_catalog', type: 'Additive', risk: 'Low', note: 'Insert missing SKUs only' },
  courier_details: { crm: 'sm_courier_details', type: 'Direct', risk: 'Low', note: '' },
  issue_types: { crm: 'support_issue_categories', type: 'Transform', risk: 'Low', note: '' },
  business_settings: { crm: null, type: 'Skip', risk: 'Low', note: 'PRESERVE companies/support_settings; optional field-level merge if CRM empty' },
  last_unique_number: { crm: 'sm_document_sequences', type: 'MonotonicBump', risk: 'Medium', note: 'GREATEST(crm, erp) only — never lower sequences' },
  warehouse: { crm: 'teams (warehouse team)', type: 'Transform', risk: 'Low', note: '' },

  // Vendors
  sellers: { crm: 'vendors + vendor_shops', type: 'Transform', risk: 'High', note: 'ERP sellers = CRM vendors; shop details separate' },
  seller_wallets: { crm: 'vendor_wallets', type: 'Partial', risk: 'Medium', note: '' },
  seller_wallet_histories: { crm: null, type: 'Gap', risk: 'Medium', note: 'No direct CRM wallet history table' },

  // Customers
  customers: { crm: 'customers + customer_addresses + customer_documents', type: 'Transform', risk: 'High', note: 'Wide ERP row → normalized CRM; portal passwords → customer_portal_sessions' },
  customers_backup: { crm: null, type: 'Skip', risk: 'Low', note: 'Legacy backup table' },
  customers_update: { crm: null, type: 'Skip', risk: 'Low', note: 'Staging table' },
  customer_audit_logs: { crm: 'ttspl_audit_log / permission_audit_logs', type: 'Partial', risk: 'Medium', note: 'Audit semantics differ' },
  customer_credit_note: { crm: 'customer_credit_notes', type: 'Transform', risk: 'High', note: 'Financial amounts must reconcile' },
  customer_rent_devices: { crm: 'customer_inventory + rent_devices', type: 'Transform', risk: 'High', note: 'Active rental assignments' },
  customer_wallets: { crm: 'customer_security_deposits', type: 'Partial', risk: 'High', note: 'Wallet vs security deposit model differs' },
  customer_wallet_histories: { crm: null, type: 'Gap', risk: 'Medium', note: '' },
  billing_addresses: { crm: 'customer_addresses', type: 'Transform', risk: 'Medium', note: '' },
  shipping_addresses: { crm: 'customer_addresses', type: 'Transform', risk: 'Medium', note: '' },
  billing_manager: { crm: 'customer_invoices + users', type: 'Transform', risk: 'High', note: 'Billing cycles → CRM billing engine tables' },

  // Inventory & Assets
  inventory: { crm: 'inventory', type: 'Transform', risk: 'Critical', note: 'Status enum mapping; JSON extra_details; serial linkage' },
  product_details: { crm: 'vendor_product_details + inventory', type: 'Transform', risk: 'Critical', note: 'PO line / GRN product specs' },
  products: { crm: 'vendor_product_inventory', type: 'Partial', risk: 'Medium', note: 'E-commerce product catalog; may not all apply' },
  product_stocks: { crm: 'vendor_product_inventory', type: 'Partial', risk: 'Medium', note: '' },
  serial_numbers: { crm: 'vendor_serial_numbers', type: 'Transform', risk: 'Critical', note: 'Serial uniqueness; TTSPL vs rental flags' },
  serial_number_parts: { crm: 'part_instances + vendor_serial_numbers', type: 'Transform', risk: 'High', note: '' },
  serial_numberOnly: { crm: 'vendor_serial_numbers', type: 'Partial', risk: 'Medium', note: 'Legacy serial capture' },
  serial_number_update_logs: { crm: 'vendor_serial_number_audit', type: 'Transform', risk: 'Medium', note: '' },
  rent_devices: { crm: 'rent_devices', type: 'Transform', risk: 'High', note: 'Device master catalog' },
  assigned_assets: { crm: 'customer_inventory', type: 'Transform', risk: 'High', note: '' },
  npa_assets: { crm: 'inventory (disposition=npa)', type: 'Transform', risk: 'Medium', note: '' },
  old_product_details: { crm: null, type: 'Archive', risk: 'Low', note: 'Historical archive; optional JSON import' },

  // Procurement
  purchase_orders: { crm: 'vendor_purchase_orders', type: 'Transform', risk: 'Critical', note: 'PO header; status workflow mapping' },
  goods_received_notes: { crm: 'vendor_goods_received_notes + grn_*', type: 'Transform', risk: 'Critical', note: 'GRN headers + access numbers + serial capture tokens' },
  goods_received_notes_parts: { crm: 'vendor_goods_received_notes (parts lines)', type: 'Transform', risk: 'High', note: '' },
  spare_parts: { crm: 'spare_parts + vendor_spare_parts_catalog', type: 'Transform', risk: 'Medium', note: '' },
  spare_parts_po: { crm: 'vendor_spare_parts_purchase_orders', type: 'Transform', risk: 'High', note: '' },

  // Sales
  quotations: { crm: 'sales_quotations', type: 'Transform', risk: 'High', note: 'Quote lines embedded in ERP → normalized lines' },
  sales_orders: { crm: 'sales_order_lines + sales_order_serials + sales_order_payments + orders', type: 'Transform', risk: 'Critical', note: 'ERP sales_orders is monolithic; CRM splits across SO module + legacy orders' },
  orders: { crm: 'orders + order_items', type: 'Partial', risk: 'High', note: 'ERP e-commerce orders; may overlap sales_orders' },
  order_details: { crm: 'order_items', type: 'Transform', risk: 'Medium', note: '' },

  // Delivery & DC
  delivery_challans: { crm: 'delivery_challan_lines + demo_agreements', type: 'Transform', risk: 'Critical', note: 'DC lines; OTP/esign fields in CRM migrations 086/102' },
  delivery_men: { crm: 'delivery_technicians', type: 'Transform', risk: 'Medium', note: '' },
  delivery_histories: { crm: 'activities / work_logs', type: 'Partial', risk: 'Medium', note: '' },
  pod_submissions: { crm: 'delivery_challan_lines (pod fields)', type: 'Transform', risk: 'High', note: 'Proof of delivery' },
  qc_truetech_delivery_challans: { crm: 'dc_qc_tickets', type: 'Transform', risk: 'High', note: '' },

  // QC
  qc: { crm: 'qc_results + qc_photos', type: 'Transform', risk: 'High', note: 'Historical QC only — CRM stages/stage_checklists PRESERVED' },
  qc_logs: { crm: 'qc_results / repair_logs', type: 'Partial', risk: 'Medium', note: '' },

  // Support
  complaints_ticket: { crm: 'support_tickets + support_ticket_items + tickets', type: 'Transform', risk: 'Critical', note: 'ERP complaints → CRM support v3 model' },
  support_tickets: { crm: 'support_tickets', type: 'Partial', risk: 'Medium', note: 'Generic support; lower volume than complaints_ticket' },
  support_ticket_convs: { crm: 'support_ticket_item_comments', type: 'Transform', risk: 'Medium', note: '' },
  repair_logs: { crm: 'repair_logs + chip_level_repairs', type: 'Transform', risk: 'Medium', note: '' },
  damage_parts_amount: { crm: 'diagnosis_parts_required + ticket_parts', type: 'Transform', risk: 'High', note: '' },

  // Logs & Audit
  allocation_logs: { crm: 'allocation_logs', type: 'Direct', risk: 'Medium', note: 'Column names differ slightly; FK ids remapped' },
  inward_outward: { crm: 'inward_outward', type: 'Direct', risk: 'Medium', note: '' },
  insert_allocation_log_old_new: { crm: null, type: 'Skip', risk: 'Low', note: 'Migration staging' },

  // Billing / Finance
  credit_and_debit_note: { crm: 'vendor_debit_notes + customer_credit_notes', type: 'Transform', risk: 'Critical', note: '' },
  invoices: { crm: 'customer_invoices + einvoice_records', type: 'Transform', risk: 'Critical', note: '' },
  paytabs_invoices: { crm: 'customer_invoices', type: 'Partial', risk: 'Medium', note: '' },
  split_rent_billing: { crm: 'customer_invoices (billing engine)', type: 'Transform', risk: 'High', note: '' },
  rent_reports: { crm: null, type: 'Gap', risk: 'Medium', note: 'Reporting aggregate; may regenerate from customer_inventory' },
  rent_reports_customer: { crm: null, type: 'Gap', risk: 'Medium', note: '' },

  // Leads (CRM-only origin possible)
  contacts: { crm: null, type: 'Skip', risk: 'Low', note: 'CRM leads preserved; ERP contacts import disabled by default' },

  // CMS / E-commerce — skip
  about_sliders: { crm: null, type: 'Skip', risk: 'None', note: 'CMS' },
  banners: { crm: null, type: 'Skip', risk: 'None', note: 'CMS' },
  blog_posts: { crm: null, type: 'Skip', risk: 'None', note: 'CMS' },
  carts: { crm: null, type: 'Skip', risk: 'None', note: 'E-commerce' },
  cart_shippings: { crm: null, type: 'Skip', risk: 'None', note: '' },
  categories: { crm: null, type: 'Skip', risk: 'None', note: 'E-commerce categories' },
  coupons: { crm: null, type: 'Skip', risk: 'None', note: '' },
  colors: { crm: null, type: 'Skip', risk: 'None', note: '' },
  chattings: { crm: null, type: 'Skip', risk: 'None', note: '' },
  cache: { crm: null, type: 'Skip', risk: 'None', note: '' },
  failed_jobs: { crm: null, type: 'Skip', risk: 'None', note: '' },
  jobs: { crm: null, type: 'Skip', risk: 'None', note: '' },
  migrations: { crm: 'schema_migrations', type: 'Skip', risk: 'None', note: 'Do not migrate Laravel migrations table' },
  oauth_access_tokens: { crm: null, type: 'Skip', risk: 'None', note: 'Regenerate sessions' },
  oauth_auth_codes: { crm: null, type: 'Skip', risk: 'None', note: '' },
  oauth_clients: { crm: null, type: 'Skip', risk: 'None', note: '' },
  oauth_personal_access_clients: { crm: null, type: 'Skip', risk: 'None', note: '' },
  oauth_refresh_tokens: { crm: null, type: 'Skip', risk: 'None', note: '' },
  personal_access_tokens: { crm: null, type: 'Skip', risk: 'None', note: '' },
  password_resets: { crm: null, type: 'Skip', risk: 'None', note: '' },
  phone_or_email_verifications: { crm: null, type: 'Skip', risk: 'None', note: '' },
  sessions: { crm: null, type: 'Skip', risk: 'None', note: '' },
  notifications: { crm: 'email_queue', type: 'Partial', risk: 'Low', note: '' },
  wishlists: { crm: null, type: 'Skip', risk: 'None', note: '' },
  reviews: { crm: null, type: 'Skip', risk: 'None', note: '' },
  review_sets: { crm: null, type: 'Skip', risk: 'None', note: '' },
  subscriptions: { crm: null, type: 'Skip', risk: 'None', note: '' },
  translations: { crm: null, type: 'Skip', risk: 'None', note: '' },
  video: { crm: null, type: 'Skip', risk: 'None', note: '' },
  videos: { crm: null, type: 'Skip', risk: 'None', note: '' },
  social_medias: { crm: null, type: 'Skip', risk: 'None', note: '' },
  soft_credentials: { crm: null, type: 'Skip', risk: 'None', note: '' },
  tags: { crm: null, type: 'Skip', risk: 'None', note: '' },
  product_tag: { crm: null, type: 'Skip', risk: 'None', note: '' },
  items: { crm: null, type: 'Skip', risk: 'Low', note: 'Generic items; verify if used' },
  data_table: { crm: null, type: 'Skip', risk: 'None', note: '' },
  search_functions: { crm: null, type: 'Skip', risk: 'None', note: '' },
  deal_of_the_days: { crm: null, type: 'Skip', risk: 'None', note: '' },
  feature_deals: { crm: null, type: 'Skip', risk: 'None', note: '' },
  flash_deals: { crm: null, type: 'Skip', risk: 'None', note: '' },
  flash_deal_products: { crm: null, type: 'Skip', risk: 'None', note: '' },
  delivery_country_codes: { crm: null, type: 'Skip', risk: 'None', note: '' },
  delivery_zip_codes: { crm: null, type: 'Skip', risk: 'None', note: '' },
  deliveryman_notifications: { crm: null, type: 'Skip', risk: 'None', note: '' },
  deliveryman_wallets: { crm: null, type: 'Skip', risk: 'None', note: '' },
  delivery_man_transactions: { crm: null, type: 'Skip', risk: 'None', note: '' },
  emergency_contacts: { crm: null, type: 'Skip', risk: 'Low', note: '' },
  help_topics: { crm: null, type: 'Skip', risk: 'None', note: '' },
  loyalty_point_transactions: { crm: null, type: 'Skip', risk: 'None', note: '' },
  refund_requests: { crm: null, type: 'Skip', risk: 'Low', note: 'E-commerce refunds' },
  refund_statuses: { crm: null, type: 'Skip', risk: 'None', note: '' },
  refund_transactions: { crm: null, type: 'Skip', risk: 'None', note: '' },
  order_expected_delivery_histories: { crm: 'activities', type: 'Partial', risk: 'Low', note: '' },
  order_status_histories: { crm: 'activities', type: 'Partial', risk: 'Low', note: '' },
  order_transactions: { crm: 'sales_order_payments', type: 'Partial', risk: 'Medium', note: '' },
  admin_wallets: { crm: null, type: 'Skip', risk: 'Low', note: '' },
  admin_wallet_histories: { crm: null, type: 'Skip', risk: 'Low', note: '' },
  category_shipping_costs: { crm: null, type: 'Skip', risk: 'None', note: '' },
  shipping_methods: { crm: null, type: 'Skip', risk: 'None', note: '' },
  shipping_types: { crm: null, type: 'Skip', risk: 'None', note: '' },
  shops: { crm: 'vendor_shops', type: 'Partial', risk: 'Low', note: 'Customer shops vs vendor shops' },
  stock_products: { crm: null, type: 'Skip', risk: 'Low', note: '' },
  sub_modules: { crm: 'permission_sections', type: 'Partial', risk: 'Low', note: '' },
  transactions: { crm: null, type: 'Skip', risk: 'Low', note: 'Generic transactions' },
  wallet_transactions: { crm: null, type: 'Skip', risk: 'Low', note: '' },
  withdrawal_methods: { crm: null, type: 'Skip', risk: 'None', note: '' },
  withdraw_requests: { crm: null, type: 'Skip', risk: 'None', note: '' },
  currencies: { crm: null, type: 'Skip', risk: 'Low', note: 'INR assumed in CRM' },
};

// CRM-only tables (no ERP source)
const CRM_ONLY = [
  'leads', 'lead_activities', 'lead_addresses', 'lead_assignments', 'lead_auto_assign_config',
  'lead_company_research', 'lead_followup_notifications', 'lead_import_logs', 'lead_orders', 'lead_remarks',
  'asset_config_brands', 'asset_config_models', 'asset_config_processors', 'asset_config_generations',
  'asset_config_ram', 'asset_config_storage', 'asset_config_gpu', 'asset_config_screen_sizes',
  'stages', 'stage_checklists', 'stage_transition_rules', 'inventory_status_transitions',
  'qc_round_robin_state', 'procurement_requests', 'part_requests', 'parts', 'part_instances',
  'photos', 'diagnosis_results', 'diagnosis_images', 'diagnosis_parts_required',
  'support_part_challans', 'support_part_requests', 'support_challan_items', 'support_replacement_orders',
  'ticket_checklist_progress', 'ticket_part_blocks', 'ticket_services',
  'grn_access_attempts', 'grn_access_numbers', 'grn_config_verifications', 'grn_serial_capture_tokens',
  'eway_bill_records', 'einvoice_records', 'email_queue', 'existing_customer',
  'vendor_portal_sessions', 'vendor_refresh_tokens', 'vendor_billing', 'vendor_monthly_bills',
  'vendor_replaced_products', 'vendor_inventory_asset_sequence', 'demo_agreements',
  'customer_portal_sessions', 'customer_documents', 'companies', 'work_logs', 'activities',
  'ttspl_audit_log', 'ttspl_config_history', 'permission_audit_logs', 'schema_migrations',
  'laptop_catalog', 'support_settings', 'support_ticket_item_audit',
];

function mdTable(headers, rows) {
  const sep = headers.map(() => '---');
  return [
    `| ${headers.join(' | ')} |`,
    `| ${sep.join(' | ')} |`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

function fmtCols(cols, limit = 30) {
  return cols.slice(0, limit).map((c) => `\`${c.name}\` ${c.def}`).join('; ');
}

// STEP 1: ERP Schema Analysis
function genErpAnalysis() {
  const names = Object.keys(erpTables).sort();
  const cls = data.erp.classification;
  let md = `# ERP Schema Analysis\n\n`;
  md += `> Generated: ${data.generatedAt}\n`;
  md += `> Source: \`erp_rentfoxxy_db.sql\` (MySQL / Laravel)\n`;
  md += `> Total tables: **${names.length}**\n\n`;

  md += `## Summary\n\n`;
  md += `- **Master / reference tables:** ${cls.masters.length}\n`;
  md += `- **Transaction / business tables:** ${cls.transactions.length}\n`;
  md += `- **Audit / history / log tables:** ${cls.audit.length}\n`;
  md += `- **CMS / e-commerce / infra (skip):** ${cls.cms.length}\n`;
  md += `- **Legacy / staging (skip):** ${cls.skip.length}\n\n`;

  md += `## Record Count Estimates (from SQL dump INSERT blocks)\n\n`;
  md += `Run on live MySQL for authoritative counts:\n\n\`\`\`sql\n`;
  for (const t of names) {
    md += `SELECT '${t}' AS tbl, COUNT(*) AS cnt FROM \`${t}\` UNION ALL\n`;
  }
  md = md.replace(/ UNION ALL\n$/, ';\n');
  md += `\`\`\`\n\n`;

  md += `### Top tables by estimated rows\n\n`;
  const top = Object.entries(erpRows).sort((a, b) => b[1] - a[1]).slice(0, 25);
  md += mdTable(['Table', 'Est. Rows', 'Soft Delete'], top.map(([t, n]) => [
    t, String(n), erpTables[t]?.softDelete ? 'Yes' : 'No',
  ])) + '\n\n';

  md += `## Master Tables\n\n${cls.masters.map((t) => `- \`${t}\``).join('\n')}\n\n`;
  md += `## Transaction Tables\n\n${cls.transactions.map((t) => `- \`${t}\``).join('\n')}\n\n`;
  md += `## Audit / Log Tables\n\n${cls.audit.map((t) => `- \`${t}\``).join('\n')}\n\n`;

  md += `## Full Table Catalog\n\n`;
  for (const t of names) {
    const tbl = erpTables[t];
    md += `### \`${t}\`\n\n`;
    md += `- **Est. rows:** ${erpRows[t] ?? 'unknown'}\n`;
    md += `- **Soft delete:** ${tbl.softDelete ? 'Yes (`deleted_at`)' : 'No'}\n`;
    md += `- **Columns (${tbl.cols.length}):** ${fmtCols(tbl.cols)}\n`;
    if (tbl.indexes.length) md += `- **Indexes:** ${tbl.indexes.slice(0, 5).join('; ')}${tbl.indexes.length > 5 ? '…' : ''}\n`;
    if (tbl.fks.length) md += `- **Foreign keys:** ${tbl.fks.join('; ')}\n`;
    md += `- **CRM mapping:** ${MAPPINGS[t]?.type ?? 'TBD'} → ${MAPPINGS[t]?.crm ?? 'TBD'}\n\n`;
  }
  return md;
}

// STEP 2: CRM Schema Analysis
function genCrmAnalysis() {
  const publicTables = Object.entries(crmTables).filter(([k]) => k.startsWith('public.')).sort();
  let md = `# CRM Schema Analysis\n\n`;
  md += `> Generated: ${data.generatedAt}\n`;
  md += `> Source: \`crm_backup.sql\` (PostgreSQL / Node.js)\n`;
  md += `> Total tables: **${Object.keys(crmTables).length}** (${data.crm.publicTableCount} public, ${data.crm.authTableCount} auth)\n\n`;

  md += `## Business Modules (public schema)\n\n`;
  const modules = {
    'Identity & RBAC': ['users', 'roles', 'role_permissions', 'user_permissions', 'permission_sections', 'teams', 'user_teams'],
    'Lead CRM': ['leads', 'lead_activities', 'lead_addresses', 'lead_assignments', 'lead_company_research', 'lead_orders', 'lead_remarks'],
    'Customers': ['customers', 'customer_addresses', 'customer_documents', 'customer_inventory', 'customer_invoices', 'customer_credit_notes', 'customer_security_deposits', 'customer_portal_sessions'],
    'Sales': ['sales_quotations', 'sales_order_lines', 'sales_order_serials', 'sales_order_payments', 'orders', 'order_items', 'sm_document_sequences', 'sm_courier_details'],
    'Vendors & Procurement': ['vendors', 'vendor_shops', 'vendor_purchase_orders', 'vendor_goods_received_notes', 'vendor_serial_numbers', 'vendor_product_details', 'vendor_product_inventory', 'vendor_wallets', 'vendor_billing', 'vendor_monthly_bills', 'vendor_debit_notes', 'vendor_spare_parts_catalog', 'vendor_spare_parts_purchase_orders'],
    'Inventory & QC': ['inventory', 'allocation_logs', 'inward_outward', 'rent_devices', 'laptop_catalog', 'asset_config_brands', 'asset_config_models', 'stages', 'qc_results', 'qc_photos'],
    'Delivery': ['delivery_challan_lines', 'delivery_technicians', 'demo_agreements', 'dc_qc_tickets', 'eway_bill_records'],
    'Support': ['support_tickets', 'support_ticket_items', 'support_ticket_item_comments', 'tickets', 'ticket_parts', 'repair_logs', 'chip_level_repairs', 'diagnosis_results'],
    'Billing': ['customer_invoices', 'einvoice_records', 'companies'],
    'GRN Portal': ['grn_access_numbers', 'grn_serial_capture_tokens', 'grn_config_verifications'],
  };
  for (const [mod, tables] of Object.entries(modules)) {
    md += `### ${mod}\n\n${tables.map((t) => `- \`public.${t}\``).join('\n')}\n\n`;
  }

  md += `## CRM-Only Tables (no direct ERP table)\n\n`;
  md += CRM_ONLY.map((t) => `- \`public.${t}\``).join('\n') + '\n\n';

  md += `## Record Counts (from backup COPY blocks)\n\n`;
  const counts = Object.entries(crmRows)
    .filter(([k]) => k.startsWith('public.'))
    .sort((a, b) => b[1] - a[1]);
  md += mdTable(['Table', 'Rows in backup'], counts.slice(0, 40).map(([k, n]) => [k.replace('public.', ''), String(n)])) + '\n\n';

  md += `## Full Table Catalog\n\n`;
  for (const [key, tbl] of publicTables) {
    md += `### \`${key}\`\n\n`;
    md += `- **Rows in backup:** ${crmRows[key] ?? 0}\n`;
    md += `- **Soft delete:** ${tbl.softDelete ? 'Yes' : 'No'}\n`;
    md += `- **Required columns (NOT NULL, no default):** ${tbl.requiredCols?.join(', ') || 'none parsed'}\n`;
    md += `- **Columns (${tbl.cols.length}):** ${fmtCols(tbl.cols)}\n`;
    if (tbl.constraints.length) {
      md += `- **Constraints:** ${tbl.constraints.slice(0, 8).join('; ')}${tbl.constraints.length > 8 ? '…' : ''}\n`;
    }
    md += '\n';
  }
  return md;
}

// STEP 3: Schema Mapping
function genSchemaMapping() {
  const erpNames = Object.keys(erpTables).sort();
  let md = `# ERP → CRM Schema Mapping\n\n`;
  md += `> Generated: ${data.generatedAt}\n\n`;
  md += `## Mapping Summary\n\n`;

  const types = {};
  for (const t of erpNames) {
    const m = MAPPINGS[t] || { type: 'TBD', crm: 'TBD', risk: 'High', note: 'Not yet analyzed' };
    types[m.type] = (types[m.type] || 0) + 1;
  }
  md += mdTable(['Mapping Type', 'Count'], Object.entries(types).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, String(v)])) + '\n\n';

  md += `## Complete ERP Table Mapping\n\n`;
  md += mdTable(
    ['ERP Table', 'CRM Target', 'Type', 'Risk', 'Est. ERP Rows'],
    erpNames.map((t) => {
      const m = MAPPINGS[t] || { crm: '—', type: 'TBD', risk: 'High', note: '' };
      return [t, m.crm ?? '—', m.type, m.risk, String(erpRows[t] ?? '?')];
    })
  ) + '\n\n';

  md += `## Detailed Mapping Notes\n\n`;
  for (const t of erpNames) {
    const m = MAPPINGS[t];
    if (!m) continue;
    md += `### \`${t}\` → \`${m.crm ?? 'SKIP'}\` (${m.type})\n\n`;
    md += `- **Risk:** ${m.risk}\n`;
    md += `- **Note:** ${m.note}\n`;
    const erpCols = erpTables[t]?.cols?.map((c) => c.name) || [];
    md += `- **ERP columns (${erpCols.length}):** ${erpCols.join(', ')}\n\n`;
  }
  return md;
}

// STEP 4: Migration Order (topological from FK-like dependencies)
const MIGRATION_MODULES = [
  { id: '000', name: 'migration_meta', deps: [], tables: ['erp_id_map', 'migration_runs'] },
  { id: '002', name: 'erp_admin_users_additive', deps: [], erp: ['admins'], crm: ['users (additive only)'] },
  { id: '004', name: 'document_sequences_bump', deps: [], erp: ['last_unique_number'], crm: ['sm_document_sequences (monotonic bump only)'] },
  { id: '005', name: 'asset_config_additive', deps: [], erp: ['brands', 'attributes', 'bundle_management'], crm: ['asset_config_* (insert missing only)', 'laptop_catalog'] },
  { id: '006', name: 'vendors', deps: ['002'], erp: ['sellers'], crm: ['vendors', 'vendor_shops'] },
  { id: '007', name: 'customers', deps: ['002'], erp: ['customers', 'billing_addresses', 'shipping_addresses'], crm: ['customers', 'customer_addresses', 'customer_documents'] },
  { id: '008', name: 'courier_masters_additive', deps: [], erp: ['courier_details', 'issue_types'], crm: ['sm_courier_details', 'support_issue_categories (insert missing)'] },
  { id: '009', name: 'rent_device_catalog', deps: ['005'], erp: ['rent_devices'], crm: ['rent_devices'] },
  { id: '010', name: 'purchase_orders', deps: ['006', '005'], erp: ['purchase_orders'], crm: ['vendor_purchase_orders'] },
  { id: '011', name: 'vendor_product_details', deps: ['010'], erp: ['product_details'], crm: ['vendor_product_details'] },
  { id: '012', name: 'grn', deps: ['010', '011'], erp: ['goods_received_notes', 'goods_received_notes_parts'], crm: ['vendor_goods_received_notes', 'grn_*'] },
  { id: '013', name: 'serial_numbers', deps: ['012'], erp: ['serial_numbers', 'serial_number_parts', 'serial_numberOnly'], crm: ['vendor_serial_numbers', 'part_instances'] },
  { id: '014', name: 'inventory', deps: ['013', '007'], erp: ['inventory', 'npa_assets', 'assigned_assets'], crm: ['inventory', 'vendor_product_inventory'] },
  { id: '015', name: 'spare_parts', deps: ['006'], erp: ['spare_parts', 'spare_parts_po'], crm: ['spare_parts', 'vendor_spare_parts_*'] },
  { id: '016', name: 'quotations', deps: ['007', '002'], erp: ['quotations'], crm: ['sales_quotations'] },
  { id: '017', name: 'sales_orders', deps: ['016', '014'], erp: ['sales_orders'], crm: ['sales_order_lines', 'sales_order_serials', 'sales_order_payments'] },
  { id: '018', name: 'orders_legacy', deps: ['007'], erp: ['orders', 'order_details'], crm: ['orders', 'order_items'] },
  { id: '019', name: 'customer_rentals', deps: ['014', '007'], erp: ['customer_rent_devices'], crm: ['customer_inventory'] },
  { id: '020', name: 'delivery_challans', deps: ['017', '014'], erp: ['delivery_challans', 'pod_submissions', 'qc_truetech_delivery_challans'], crm: ['delivery_challan_lines', 'dc_qc_tickets', 'demo_agreements'] },
  { id: '021', name: 'delivery_technicians', deps: ['002'], erp: ['delivery_men'], crm: ['delivery_technicians'] },
  { id: '022', name: 'qc_results', deps: ['014'], erp: ['qc', 'qc_logs'], crm: ['qc_results', 'qc_photos (stages preserved)'] },
  { id: '023', name: 'support_tickets', deps: ['007', '014'], erp: ['complaints_ticket', 'support_tickets', 'support_ticket_convs'], crm: ['support_tickets', 'support_ticket_items', 'tickets'] },
  { id: '024', name: 'repair_diagnosis', deps: ['023'], erp: ['repair_logs', 'damage_parts_amount'], crm: ['repair_logs', 'diagnosis_*', 'ticket_parts'] },
  { id: '025', name: 'billing', deps: ['007', '017'], erp: ['billing_manager', 'invoices', 'customer_credit_note', 'credit_and_debit_note', 'split_rent_billing'], crm: ['customer_invoices', 'customer_credit_notes', 'vendor_debit_notes', 'einvoice_records'] },
  { id: '026', name: 'allocation_logs', deps: ['014', '006', '007'], erp: ['allocation_logs'], crm: ['allocation_logs'] },
  { id: '027', name: 'inward_outward', deps: ['014'], erp: ['inward_outward'], crm: ['inward_outward'] },
  { id: '028', name: 'audit_history', deps: ['002'], erp: ['customer_audit_logs', 'serial_number_update_logs'], crm: ['ttspl_audit_log', 'vendor_serial_number_audit'] },
  { id: '030', name: 'attachments', deps: ['014', '023', '012'], erp: ['file_path columns across tables'], crm: ['photos', 'customer_documents', 'qc_photos'] },
];

function genMigrationOrder() {
  let md = `# Migration Dependency Order\n\n`;
  md += `> Generated: ${data.generatedAt}\n`;
  md += `> Calculated from FK relationships and business workflow dependencies.\n\n`;
  md += `## Execution Order\n\n`;
  md += mdTable(
    ['Step', 'Module', 'Depends On', 'ERP Sources', 'CRM Targets'],
    MIGRATION_MODULES.map((m) => [
      m.id, m.name, m.deps.join(', ') || '—',
      (m.erp || []).join(', '), (m.crm || []).join(', '),
    ])
  ) + '\n\n';

  md += `## Dependency Tree (Mermaid)\n\n\`\`\`mermaid\nflowchart TD\n`;
  for (const m of MIGRATION_MODULES) {
    if (m.deps.length === 0) md += `  ${m.name}\n`;
    else for (const d of m.deps) {
      const depMod = MIGRATION_MODULES.find((x) => x.id === d);
      if (depMod) md += `  ${depMod.name} --> ${m.name}\n`;
    }
  }
  md += `\`\`\`\n\n`;

  md += `## Rules\n\n`;
  md += `1. \`erp_id_map\` must be populated before any child FK remap.\n`;
  md += `2. Never insert CRM rows with ERP IDs directly — always map via \`erp_id_map(entity, erp_id) → crm_id\`.\n`;
  md += `3. CRM sequences (\`SERIAL\`) must be advanced after bulk insert.\n`;
  md += `4. Auth tables (\`auth.*\`) are **not** migrated from ERP OAuth/Sanctum.\n`;
  md += `5. **AUTH/RBAC preserved** — see \`AUTH_TABLES.md\`; no roles/permissions/teams import.\n`;
  md += `6. **System config preserved** — see \`SYSTEM_TABLES.md\`; additive merge only where noted.\n`;
  md += `7. ERP admins → CRM users **additive only** (match by email, never overwrite existing users).\n`;
  md += `8. Existing CRM seed data must be merged additively — never truncate business or auth tables.\n`;
  return md;
}

function genGapAnalysis() {
  const erpNames = Object.keys(erpTables);
  const unmapped = erpNames.filter((t) => !MAPPINGS[t]);
  const gaps = erpNames.filter((t) => MAPPINGS[t]?.type === 'Gap');
  const skips = erpNames.filter((t) => MAPPINGS[t]?.type === 'Skip' || MAPPINGS[t]?.type?.includes('Skip'));

  let md = `# CRM Gap Analysis\n\n`;
  md += `> Generated: ${data.generatedAt}\n\n`;
  md += `## ERP Modules Not Migrated (intentional skip)\n\n`;
  md += skips.map((t) => `- \`${t}\`: ${MAPPINGS[t]?.note}`).join('\n') + '\n\n';

  md += `## ERP Data With No CRM Target (gaps)\n\n`;
  md += gaps.map((t) => `- \`${t}\` → ${MAPPINGS[t]?.note}`).join('\n') + '\n\n';

  md += `## CRM Features Without ERP Equivalent\n\n`;
  md += CRM_ONLY.map((t) => `- \`public.${t}\` — CRM-native; preserve existing rows`).join('\n') + '\n\n';

  md += `## Recommended Schema Changes (pre-migration)\n\n`;
  md += `| Change | Reason | Priority |\n| --- | --- | --- |\n`;
  md += `| Add \`erp_source_id\` + \`erp_source_table\` on major entities OR dedicated \`erp_id_map\` | ID remapping traceability | Critical |\n`;
  md += `| Add \`legacy_file_path\` text on attachments | ERP storage paths differ from CRM uploads | High |\n`;
  md += `| Confirm \`inventory.inventory_status\` enum covers all ERP statuses | Prevent state machine violations | Critical |\n`;
  md += `| Wallet history tables OR JSON audit on vendor_wallets | seller_wallet_histories gap | Medium |\n`;
  md += `| Rent report materialized views | rent_reports* gap | Low |\n`;
  return md;
}

function genPreMigrationReview() {
  const erpNames = Object.keys(erpTables);
  const direct = erpNames.filter((t) => MAPPINGS[t]?.type === 'Direct');
  const partial = erpNames.filter((t) => MAPPINGS[t]?.type === 'Partial' || MAPPINGS[t]?.type === 'Transform');
  const missing = erpNames.filter((t) => MAPPINGS[t]?.type === 'Gap' || MAPPINGS[t]?.type === 'Skip' || !MAPPINGS[t]?.crm);
  const highRisk = erpNames.filter((t) => ['Critical', 'High'].includes(MAPPINGS[t]?.risk));

  const publicCrm = Object.keys(crmTables).filter((k) => k.startsWith('public.'));

  let md = `# Pre-Migration Review\n\n`;
  md += `> Generated: ${data.generatedAt}\n`;
  md += `> **Status: REVIEW REQUIRED — migration scripts are NOT generated until sign-off on this document.**\n\n`;

  md += `## 1. Totals\n\n`;
  md += `| Metric | Count |\n| --- | --- |\n`;
  md += `| ERP tables | ${erpNames.length} |\n`;
  md += `| CRM public tables | ${publicCrm.length} |\n`;
  md += `| CRM auth tables | ${data.crm.authTableCount} |\n\n`;

  md += `## 2. Mapping Breakdown\n\n`;
  md += `| Category | Count |\n| --- | --- |\n`;
  md += `| Direct mappings | ${direct.length} |\n`;
  md += `| Transform / Partial mappings | ${partial.length} |\n`;
  md += `| Skip / Gap / No CRM target | ${missing.length} |\n\n`;

  md += `## 3. High-Risk Areas\n\n`;
  md += highRisk.map((t) => `- **\`${t}\`** (${MAPPINGS[t]?.type}) → \`${MAPPINGS[t]?.crm ?? 'N/A'}\`: ${MAPPINGS[t]?.note}`).join('\n') + '\n\n';

  md += `## 4. Required Manual Decisions\n\n`;
  md += `1. **ID strategy:** Preserve ERP IDs in \`erp_id_map\` vs offset CRM sequences?\n`;
  md += `2. **Existing CRM data:** **Additive merge only** — never truncate auth, RBAC, or config tables (see AUTH_TABLES.md, SYSTEM_TABLES.md).\n`;
  md += `3. **ERP admins:** Match by email to existing CRM users; insert only if missing; **never reset roles/permissions**.\n`;
  md += `4. **sales_orders vs orders:** ERP has both — confirm which CRM tables receive which rows.\n`;
  md += `5. **File attachments:** ERP \`storage/app/public\` paths — copy files to CRM upload dir?\n`;
  md += `6. **Document numbers:** \`last_unique_number\` → bump \`sm_document_sequences\` to MAX(crm, erp); never lower.\n`;
  md += `7. **Leads:** CRM leads preserved — ERP \`contacts\` import disabled by default.\n`;
  md += `8. **QC stage mapping:** ERP \`qc\` history maps to existing CRM \`stages\` IDs — stage definitions not replaced.\n\n`;

  md += `## 4a. Data Preservation (mandatory)\n\n`;
  md += `- **Protected auth/RBAC:** users (no overwrite), roles, role_permissions, user_permissions, teams, user_teams, permission_sections, auth.*\n`;
  md += `- **Protected system:** schema_migrations, stages, asset_config_*, support_settings, companies, lead_auto_assign_config\n`;
  md += `- **Business data only:** customers, vendors, inventory, serials, POs, GRNs, SOs, DCs, tickets, QC results, billing\n\n`;

  md += `## 5. Estimated Data Volume (ERP top tables)\n\n`;
  const top = Object.entries(erpRows).sort((a, b) => b[1] - a[1]).slice(0, 15);
  md += mdTable(['Table', 'Est. Rows'], top.map(([t, n]) => [t, String(n)])) + '\n\n';

  md += `## 6. Sign-off Checklist\n\n`;
  md += `- [ ] Manual decisions resolved\n`;
  md += `- [ ] CRM backup taken\n`;
  md += `- [ ] ERP MySQL read replica or dump import available for migration runner\n`;
  md += `- [ ] File storage migration plan approved\n`;
  md += `- [ ] Validation thresholds agreed\n`;
  md += `- [ ] Rollback window scheduled\n\n`;

  md += `## 7. Next Step\n\n`;
  md += `After sign-off, generate \`migration/scripts/*.js\` and \`migration/migrate-all.js\` per MIGRATION_ORDER.md.\n`;
  return md;
}

function genRollbackPlan() {
  return `# Rollback Plan

> Generated: ${data.generatedAt}

## Before Migration

1. **Full CRM backup**
   \`\`\`bash
   pg_dump -Fc -h HOST -U USER -d crm_db -f crm_pre_migration_$(date +%Y%m%d).dump
   \`\`\`
2. **Record CRM row counts** — run \`migration/validate-migration.js --baseline\`
3. **Snapshot ERP** — keep \`erp_rentfoxxy_db.sql\` immutable

## Rollback Steps

| Scenario | Action |
| --- | --- |
| Migration failed mid-module | Truncate tables touched by failed module + downstream; re-run from checkpoint |
| Validation failed after full run | Restore \`pg_dump\` backup entirely |
| Partial data corruption | Use \`erp_id_map\` to DELETE migrated rows by \`erp_source_table\` |

## Per-Module Rollback SQL Pattern

\`\`\`sql
-- Example: rollback users module
DELETE FROM users WHERE user_id IN (
  SELECT crm_id FROM erp_id_map WHERE entity = 'users'
);
DELETE FROM erp_id_map WHERE entity = 'users';
\`\`\`

## Recovery Process

1. Stop CRM application
2. Restore database from pre-migration dump OR run module rollback scripts
3. Clear Redis/cache if used
4. Verify with \`validate-migration.js --baseline\`
5. Restart application

## Re-run Process

Migration scripts are **idempotent**:
- Upsert on \`(entity, erp_id)\` in \`erp_id_map\`
- Skip rows already mapped
- \`migrate-all.js\` reads \`migration_runs\` checkpoint table

## Backup Retention

- Keep pre-migration dump for **30 days** minimum
- Keep ERP SQL dump permanently as source of truth
`;
}

// Write all docs
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'ERP_SCHEMA_ANALYSIS.md'), genErpAnalysis());
fs.writeFileSync(path.join(OUT, 'CRM_SCHEMA_ANALYSIS.md'), genCrmAnalysis());
fs.writeFileSync(path.join(OUT, 'SCHEMA_MAPPING.md'), genSchemaMapping());
fs.writeFileSync(path.join(OUT, 'MIGRATION_ORDER.md'), genMigrationOrder());
fs.writeFileSync(path.join(OUT, 'CRM_GAP_ANALYSIS.md'), genGapAnalysis());
fs.writeFileSync(path.join(OUT, 'PRE_MIGRATION_REVIEW.md'), genPreMigrationReview());
fs.writeFileSync(path.join(OUT, 'ROLLBACK_PLAN.md'), genRollbackPlan());

console.log('Documentation generated in migration/');
