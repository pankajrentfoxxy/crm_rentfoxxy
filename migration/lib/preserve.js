/**
 * Canonical lists of CRM tables that must NEVER be truncated or overwritten during ERP migration.
 * Used by migration runner and module scripts as guard rails.
 */

/** Supabase / GoTrue auth schema — never read or write during ERP migration */
const AUTH_SCHEMA_TABLES = [
  'auth.audit_log_entries',
  'auth.custom_oauth_providers',
  'auth.flow_state',
  'auth.identities',
  'auth.instances',
  'auth.mfa_amr_claims',
  'auth.mfa_challenges',
  'auth.mfa_factors',
  'auth.oauth_authorizations',
  'auth.oauth_client_states',
  'auth.oauth_clients',
  'auth.oauth_consents',
  'auth.one_time_tokens',
  'auth.refresh_tokens',
  'auth.saml_providers',
  'auth.saml_relay_states',
  'auth.schema_migrations',
  'auth.sessions',
  'auth.sso_domains',
  'auth.sso_providers',
  'auth.users',
];

/** CRM RBAC — preserve existing rows, role matrix, and permissions */
const RBAC_TABLES = [
  'public.roles',
  'public.role_permissions',
  'public.user_permissions',
  'public.teams',
  'public.user_teams',
  'public.permission_sections',
  'public.permission_audit_logs',
];

/**
 * public.users — special case:
 * - NEVER truncate, DELETE wholesale, or UPDATE role/password/permissions on existing rows
 * - ALLOW additive INSERT for ERP admins not already present (match by email)
 * - ALLOW erp_id_map entries pointing to existing CRM user_id
 */
const USERS_TABLE = 'public.users';

/** Portal / session tokens — never migrate from ERP; preserve CRM sessions */
const PORTAL_SESSION_TABLES = [
  'public.customer_portal_sessions',
  'public.vendor_portal_sessions',
  'public.vendor_refresh_tokens',
];

const AUTH_PROTECTED = [
  ...AUTH_SCHEMA_TABLES,
  ...RBAC_TABLES,
  USERS_TABLE,
  ...PORTAL_SESSION_TABLES,
];

/** System configuration — never truncate; no bulk overwrite from ERP */
const SYSTEM_CONFIG_TABLES = [
  'public.schema_migrations',
  'public.companies',
  'public.support_settings',
  'public.lead_auto_assign_config',
  'public.stages',
  'public.stage_checklists',
  'public.stage_transition_rules',
  'public.qc_round_robin_state',
  'public.asset_config_brands',
  'public.asset_config_models',
  'public.asset_config_processors',
  'public.asset_config_generations',
  'public.asset_config_ram',
  'public.asset_config_storage',
  'public.asset_config_gpu',
  'public.asset_config_screen_sizes',
  'public.sm_document_sequences',
  'public.vendor_inventory_asset_sequence',
  'public.support_settings',
  'public.ttspl_config_history',
];

/** Migration infrastructure — created by toolkit; never truncate mid-run except rollback */
const MIGRATION_TRACKING_TABLES = [
  'public.erp_id_map',
  'public.migration_runs',
];

const SYSTEM_PROTECTED = [
  ...SYSTEM_CONFIG_TABLES,
  ...MIGRATION_TRACKING_TABLES,
];

/** CRM-native modules — preserve existing CRM data; ERP import optional/additive only */
const CRM_NATIVE_PRESERVE = [
  'public.leads',
  'public.lead_activities',
  'public.lead_addresses',
  'public.lead_assignments',
  'public.lead_company_research',
  'public.lead_followup_notifications',
  'public.lead_import_logs',
  'public.lead_orders',
  'public.lead_remarks',
];

/** Business data — safe to migrate additively from ERP (no truncate) */
const BUSINESS_TABLES = [
  'public.customers',
  'public.customer_addresses',
  'public.customer_documents',
  'public.customer_inventory',
  'public.customer_invoices',
  'public.customer_credit_notes',
  'public.customer_security_deposits',
  'public.vendors',
  'public.vendor_shops',
  'public.vendor_wallets',
  'public.vendor_purchase_orders',
  'public.vendor_goods_received_notes',
  'public.vendor_product_details',
  'public.vendor_product_inventory',
  'public.vendor_serial_numbers',
  'public.vendor_serial_number_audit',
  'public.vendor_billing',
  'public.vendor_monthly_bills',
  'public.vendor_debit_notes',
  'public.vendor_spare_parts_catalog',
  'public.vendor_spare_parts_purchase_orders',
  'public.vendor_replaced_products',
  'public.vendor_audit_logs',
  'public.inventory',
  'public.inventory_status_transitions',
  'public.rent_devices',
  'public.allocation_logs',
  'public.inward_outward',
  'public.sales_quotations',
  'public.sales_order_lines',
  'public.sales_order_serials',
  'public.sales_order_payments',
  'public.orders',
  'public.order_items',
  'public.delivery_challan_lines',
  'public.delivery_technicians',
  'public.demo_agreements',
  'public.dc_qc_tickets',
  'public.eway_bill_records',
  'public.einvoice_records',
  'public.support_tickets',
  'public.support_ticket_items',
  'public.support_ticket_item_comments',
  'public.support_ticket_item_audit',
  'public.tickets',
  'public.ticket_parts',
  'public.ticket_services',
  'public.ticket_part_blocks',
  'public.ticket_checklist_progress',
  'public.support_part_challans',
  'public.support_part_requests',
  'public.support_challan_items',
  'public.support_replacement_orders',
  'public.qc_results',
  'public.qc_photos',
  'public.repair_logs',
  'public.chip_level_repairs',
  'public.diagnosis_results',
  'public.diagnosis_images',
  'public.diagnosis_parts_required',
  'public.parts',
  'public.part_instances',
  'public.part_requests',
  'public.spare_parts',
  'public.photos',
  'public.grn_access_numbers',
  'public.grn_access_attempts',
  'public.grn_config_verifications',
  'public.grn_serial_capture_tokens',
  'public.procurement_requests',
  'public.work_logs',
  'public.activities',
  'public.ttspl_audit_log',
  'public.email_queue',
  'public.existing_customer',
];

/** Master data — additive merge only (INSERT where not exists); never truncate */
const ADDITIVE_MASTER_TABLES = [
  'public.sm_courier_details',
  'public.support_issue_categories',
  'public.laptop_catalog',
];

const ALL_PROTECTED = [
  ...AUTH_PROTECTED,
  ...SYSTEM_PROTECTED,
  ...CRM_NATIVE_PRESERVE,
];

const FORBIDDEN_SQL_PATTERNS = [
  /\bTRUNCATE\b/i,
  /\bDROP\s+TABLE\b/i,
  /\bDELETE\s+FROM\s+(users|roles|role_permissions|user_permissions|teams|user_teams|permission_sections)\b/i,
];

function assertSafeSql(sql, context = '') {
  for (const pat of FORBIDDEN_SQL_PATTERNS) {
    if (pat.test(sql)) {
      throw new Error(`Blocked unsafe SQL${context ? ` (${context})` : ''}: ${sql.slice(0, 120)}`);
    }
  }
  for (const tbl of ALL_PROTECTED) {
    const short = tbl.replace('public.', '');
    const destructive = new RegExp(`\\b(DELETE\\s+FROM|TRUNCATE)\\s+${short}\\b`, 'i');
    if (destructive.test(sql)) {
      throw new Error(`Blocked destructive operation on protected table ${tbl}`);
    }
  }
}

function isProtectedTable(tableName) {
  const normalized = tableName.includes('.') ? tableName : `public.${tableName}`;
  return ALL_PROTECTED.includes(normalized) || normalized.startsWith('auth.');
}

module.exports = {
  AUTH_SCHEMA_TABLES,
  RBAC_TABLES,
  USERS_TABLE,
  PORTAL_SESSION_TABLES,
  AUTH_PROTECTED,
  SYSTEM_CONFIG_TABLES,
  MIGRATION_TRACKING_TABLES,
  SYSTEM_PROTECTED,
  CRM_NATIVE_PRESERVE,
  BUSINESS_TABLES,
  ADDITIVE_MASTER_TABLES,
  ALL_PROTECTED,
  assertSafeSql,
  isProtectedTable,
};
