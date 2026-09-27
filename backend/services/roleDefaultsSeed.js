const pool = require('../config/db');

const FINANCIAL_NO_DELETE = [
  'customer_billing', 'vendor_billing_mgmt', 'credit_notes', 'debit_notes', 'security_deposits',
];

// Sections a reset of the blanket admin role must not pick up: they belong to one team.
const ADMIN_EXCLUDED_SECTIONS = ['sale_in_place'];

const ROLE_ROW_DEFAULTS = {
  manager: [
    ['dashboard', false, false, false], ['analytics_dashboard', false, false, false],
    ['leads', true, true, false], ['lead_follow_ups', true, true, false], ['lead_conversion', true, true, false],
    ['customers', true, true, false], ['customer_documents', true, true, false],
    ['sales_quotations', true, true, false], ['sales_orders_sale', true, true, false], ['sales_orders_rental', true, true, false],
    ['sales_order_cancel', true, false, true],
    ['delivery_challans', true, true, false], ['return_dc', false, true, false],
    ['delivery_register_management', false, true, false], ['payment_records', true, true, false],
    ['vendor_management', true, true, false], ['vendor_repair_dc', true, true, false], ['vendor_repair_dc_dispatch', true, true, false], ['procurement', true, true, false], ['sales_pipeline', true, true, false],
    ['floor_pipeline', true, true, false], ['floor_tickets', false, true, false], ['floor_ticket_config_edit', false, true, false], ['chip_level_repair', false, true, false],
    ['diagnosis_failed', true, true, false],
    ['qc_management', false, true, false], ['inventory', false, true, false], ['inventory_management', false, true, false],
    ['ready_to_rent_location', false, true, false],
    ['dispatch_charger', true, true, false], ['dispatch_charger_warehouse', false, true, false],
    ['parts_inventory', true, true, false], ['parts_dashboard', false, false, false], ['parts_approval', false, true, false],
    ['parts_history', false, false, false], ['parts_procurement', true, true, false], ['parts_discarded', false, true, false],
    ['scrap_challans', false, true, false], ['parts_detach', false, true, false], ['part_vendor_repair', true, true, false], ['ttspl_history', false, false, false],
    ['support_part_challan', false, true, false], ['support_part_requests', false, true, false],
    ['warehouse', false, true, false], ['dispatch', false, true, false], ['dispatch_ops', false, true, false],
    ['customer_billing', true, true, false], ['vendor_billing_mgmt', true, true, false],
    ['credit_notes', true, true, false], ['debit_notes', true, true, false], ['security_deposits', true, true, false],
    ['billing_dashboard', false, false, false], ['einvoice_ewb', true, false, false],
    ['support_tickets', true, true, false], ['reports', false, false, false], ['reports_access', false, false, false],
    ['report_revenue', false, false, false], ['report_inventory', false, false, false],
    ['report_lead_conversion', false, false, false], ['report_salesperson', false, false, false],
    ['report_collections', false, false, false], ['report_vendor_spend', false, false, false],
    ['report_laptop', false, false, false], ['report_warehouse_laptops', false, false, false],
    ['report_sales_order', false, false, false], ['report_support_daily', false, false, false],
    ['report_inward_outward', false, false, false],
    ['production_qc_report', false, false, false],
    ['reports_export', true, false, false],
    ['users', true, true, false], ['teams', true, true, false], ['roles', false, false, false],
    ['role_permissions', false, true, false], ['user_permissions', false, true, false],
  ],
  sales: [
    ['dashboard', false, false, false], ['leads', true, true, false], ['lead_follow_ups', true, true, false],
    ['lead_conversion', true, false, false], ['customers', true, true, false], ['customer_documents', true, false, false],
    ['sales_quotations', true, false, false], ['sales_orders_sale', true, false, false], ['sales_orders_rental', true, false, false],
    ['sales_order_cancel', true, false, true], ['delivery_challans', false, false, false],
    ['inventory', false, false, false], ['inventory_management', false, false, false], ['ttspl_history', false, false, false],
    ['support_tickets', false, false, false], ['reports_access', false, false, false],
    ['report_revenue', false, false, false], ['report_inventory', false, false, false],
    ['report_lead_conversion', false, false, false], ['report_salesperson', false, false, false],
    ['report_collections', false, false, false], ['report_vendor_spend', false, false, false],
    ['report_laptop', false, false, false], ['report_warehouse_laptops', false, false, false],
    ['report_sales_order', false, false, false], ['report_support_daily', false, false, false],
    ['report_inward_outward', false, false, false],
  ],
  floor_manager: [
    ['dashboard', false, false, false], ['floor_pipeline', true, true, false], ['floor_tickets', true, true, false],
    ['floor_ticket_config_edit', false, true, false],
    ['chip_level_repair', true, true, false], ['qc_management', false, true, false],
    ['inventory', false, true, false], ['inventory_management', false, true, false],
    ['ready_to_rent_location', false, true, false],
    ['dispatch_charger', true, true, false], ['dispatch_charger_warehouse', false, true, false],
    ['parts_inventory', true, true, false],
    ['parts_dashboard', false, false, false], ['parts_approval', false, true, false],
    ['parts_detach', false, true, false],
    ['part_vendor_repair', true, true, false],
    ['vendor_repair_dc', true, true, false],
    ['vendor_repair_dc_dispatch', true, true, false],
    ['diagnosis_failed', true, true, false],
    ['guard_gate_checking', true, true, false],
    ['gate_dashboard', true, true, false],
    ['ttspl_history', false, false, false], ['warehouse', false, true, false], ['vendor_management', false, false, false],
    ['reports_access', false, false, false], ['production_qc_report', false, false, false],
    ['report_revenue', false, false, false], ['report_inventory', false, false, false],
    ['report_lead_conversion', false, false, false], ['report_salesperson', false, false, false],
    ['report_collections', false, false, false], ['report_vendor_spend', false, false, false],
    ['report_laptop', false, false, false], ['report_warehouse_laptops', false, false, false],
    ['report_sales_order', false, false, false], ['report_support_daily', false, false, false],
    ['report_inward_outward', false, false, false],
    ['support_tickets', false, false, false],
  ],
  team_member: [
    ['dashboard', false, false, false], ['floor_pipeline', false, true, false], ['floor_tickets', false, true, false],
    ['chip_level_repair', false, true, false], ['parts_inventory', false, false, false], ['ttspl_history', false, false, false],
  ],
  team_lead: [
    ['dashboard', false, false, false], ['floor_pipeline', true, true, false], ['floor_tickets', true, true, false],
    ['floor_ticket_config_edit', false, true, false],
    ['chip_level_repair', true, true, false], ['parts_inventory', false, false, false], ['ttspl_history', false, false, false],
  ],
  qc: [
    ['dashboard', false, false, false], ['floor_pipeline', false, true, false], ['floor_tickets', false, true, false],
    ['qc_management', false, true, false], ['production_qc_report', false, false, false],
    ['ttspl_history', false, false, false], ['inventory_management', false, false, false],
  ],
  dispatch_qc: [
    ['dashboard', false, false, false], ['floor_pipeline', false, true, false], ['floor_tickets', false, true, false],
    ['qc_management', false, true, false], ['dispatch_ops', false, true, false],
    ['dispatch_charger', true, true, false],
    ['ttspl_history', false, false, false], ['inventory_management', false, false, false],
  ],
  procurement: [
    ['dashboard', false, false, false], ['vendor_management', true, true, false], ['procurement', true, true, false],
    ['inventory_management', false, false, false], ['parts_inventory', true, true, false],
    ['parts_procurement', true, true, false],
    ['part_vendor_repair', true, true, false],
    ['vendor_repair_dc', true, true, false],
  ],
  guard: [
    ['guard_gate_checking', true, true, false],
    ['gate_dashboard', true, true, false],
  ],
  warehouse: [
    ['dashboard', false, false, false], ['warehouse', true, true, false], ['guard_gate_checking', true, true, false], ['gate_dashboard', true, true, false], ['inventory', false, true, false],
    ['inventory_management', false, true, false],
    ['ready_to_rent_location', false, true, false],
    ['dispatch_charger', false, false, false], ['dispatch_charger_warehouse', false, true, false],
    ['parts_inventory', true, true, false],
    ['parts_dashboard', false, false, false], ['parts_approval', false, true, false], ['parts_history', false, false, false],
    ['parts_discarded', true, true, false], ['scrap_challans', true, true, false],
    ['parts_detach', false, true, false],
    ['part_vendor_repair', true, true, false],
    ['vendor_repair_dc', true, true, false],
    ['vendor_repair_dc_dispatch', true, true, false],
    ['diagnosis_failed', true, true, false],
    ['support_part_challan', true, true, false],
    ['delivery_challans', false, true, false], ['ttspl_history', false, false, false], ['vendor_management', false, false, false],
  ],
  dispatch: [
    ['dashboard', false, false, false], ['dispatch', false, true, false], ['dispatch_ops', false, true, false],
    ['delivery_challans', false, true, false], ['delivery_register_management', false, true, false],
    ['technician_bucket', false, true, false],
    ['guard_gate_checking', true, true, false],
    ['gate_dashboard', true, true, false],
    ['einvoice_ewb', true, true, false], ['customers', false, false, false],
    ['dispatch_charger', true, true, false],
  ],
  accounts: [
    ['dashboard', false, false, false], ['customer_billing', true, true, false], ['vendor_billing_mgmt', true, true, false],
    ['credit_notes', true, false, false], ['debit_notes', true, false, false], ['security_deposits', true, true, false],
    ['billing_dashboard', false, false, false], ['einvoice_ewb', true, false, false],
    ['sale_in_place', true, true, false],
    ['reports_access', false, false, false], ['production_qc_report', false, false, false],
    ['report_revenue', false, false, false], ['report_inventory', false, false, false],
    ['report_lead_conversion', false, false, false], ['report_salesperson', false, false, false],
    ['report_collections', false, false, false], ['report_vendor_spend', false, false, false],
    ['report_laptop', false, false, false], ['report_warehouse_laptops', false, false, false],
    ['report_sales_order', false, false, false], ['report_support_daily', false, false, false],
    ['report_inward_outward', false, false, false],
    ['reports_export', true, false, false],
    ['customers', false, false, false], ['delivery_challans', false, false, false], ['ttspl_history', false, false, false],
    ['payment_records', true, true, false],
  ],
  support_lead: [
    ['dashboard', false, false, false], ['support_tickets', true, true, false], ['support_settings', false, true, false],
    ['support_technician', false, true, false], ['technician_bucket', false, true, false],
    ['support_part_requests', true, true, false], ['support_part_challan', true, true, false],
    ['sales_orders_replacement', true, true, false], ['replacement_so_laptop_qc', false, true, false],
    ['diagnosis_failed', true, true, false],
    ['vendor_repair_dc_dispatch', true, true, false],
    ['customers', false, false, false], ['customer_inventory', false, false, false], ['ttspl_history', false, false, false],
    ['dispatch_charger', false, true, false],
  ],
  support_tech: [
    ['dashboard', false, false, false], ['support_tickets', true, true, false],
    ['support_technician', false, true, false], ['technician_bucket', false, true, false],
    ['support_part_requests', true, true, false],
    ['customers', false, false, false], ['customer_inventory', false, false, false],
    ['dispatch_charger', false, true, false],
  ],
};

/**
 * Default rows for a role, one per section. Duplicate sections in the table
 * above (manager listed a few twice, which made "Apply defaults" fail with a
 * unique-constraint 500) are merged: a flag is on if any copy has it on.
 */
function defaultRowsFor(role) {
  const rows = ROLE_ROW_DEFAULTS[role];
  if (!rows) return null;
  const merged = new Map();
  for (const [section, create, edit, del] of rows) {
    const prev = merged.get(section);
    merged.set(section, prev
      ? [section, prev[1] || create, prev[2] || edit, prev[3] || del]
      : [section, !!create, !!edit, !!del]);
  }
  return [...merged.values()];
}

/** super_admin and admin are derived from the catalogue; others need a table entry. */
function hasRoleDefaults(role) {
  return role === 'super_admin' || role === 'admin' || !!ROLE_ROW_DEFAULTS[role];
}

function noDefaultsError(role) {
  const err = new Error(`No default permissions are defined for role "${role}". Nothing was changed.`);
  err.code = 'NO_ROLE_DEFAULTS';
  err.status = 400;
  return err;
}

/**
 * Reset a role to its defaults inside the caller's transaction.
 *
 * Order matters: the defaults are written first (upsert), and only then are the
 * role's rows outside the default set removed — so a failed insert can never
 * leave the role with nothing (the old version DELETEd first and silently
 * wiped every role other than super_admin / admin / manager). Roles without
 * defaults are refused. Scope columns (data_scope, customer_access,
 * inventory_tag_access) on rows that already exist are kept.
 */
async function seedRoleDefaults(client, role) {
  if (!hasRoleDefaults(role)) throw noDefaultsError(role);

  if (role === 'super_admin' || role === 'admin') {
    const isAdmin = role === 'admin';
    await client.query(
      `INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
       SELECT $1, ps.section, true, true, true,
              CASE WHEN $2::boolean AND ps.section = ANY($3::text[]) THEN false ELSE true END
         FROM permission_sections ps
        WHERE NOT ($2::boolean AND ps.section = ANY($4::text[]))
       ON CONFLICT (role, section) DO UPDATE SET
         can_view = EXCLUDED.can_view,
         can_create = EXCLUDED.can_create,
         can_edit = EXCLUDED.can_edit,
         can_delete = EXCLUDED.can_delete`,
      [role, isAdmin, FINANCIAL_NO_DELETE, ADMIN_EXCLUDED_SECTIONS]
    );
    await client.query(
      `DELETE FROM role_permissions rp
        WHERE rp.role = $1
          AND (NOT EXISTS (SELECT 1 FROM permission_sections ps WHERE ps.section = rp.section)
               OR ($2::boolean AND rp.section = ANY($3::text[])))`,
      [role, isAdmin, ADMIN_EXCLUDED_SECTIONS]
    );
    return;
  }

  const rows = defaultRowsFor(role);
  if (!rows || !rows.length) throw noDefaultsError(role);
  for (const [section, create, edit, del] of rows) {
    // eslint-disable-next-line no-await-in-loop
    await client.query(
      `INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
       VALUES ($1, $2, true, $3, $4, $5)
       ON CONFLICT (role, section) DO UPDATE SET
         can_view = EXCLUDED.can_view,
         can_create = EXCLUDED.can_create,
         can_edit = EXCLUDED.can_edit,
         can_delete = EXCLUDED.can_delete`,
      [role, section, create, edit, del]
    );
  }
  await client.query(
    'DELETE FROM role_permissions WHERE role = $1 AND NOT (section = ANY($2::text[]))',
    [role, rows.map((r) => r[0])]
  );
}

async function applyRoleDefaults(role) {
  if (!hasRoleDefaults(role)) throw noDefaultsError(role);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await seedRoleDefaults(client, role);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  applyRoleDefaults,
  seedRoleDefaults,
  hasRoleDefaults,
  defaultRowsFor,
  ROLE_ROW_DEFAULTS,
};
