const pool = require('../config/db');

const FINANCIAL_NO_DELETE = [
  'customer_billing', 'vendor_billing_mgmt', 'credit_notes', 'debit_notes', 'security_deposits',
];

const ROLE_ROW_DEFAULTS = {
  manager: [
    ['dashboard', false, false, false], ['analytics_dashboard', false, false, false],
    ['leads', true, true, false], ['lead_follow_ups', true, true, false], ['lead_conversion', true, true, false],
    ['customers', true, true, false], ['customer_documents', true, true, false],
    ['sales_quotations', true, true, false], ['sales_orders_sale', true, true, false], ['sales_orders_rental', true, true, false],
    ['sales_order_cancel', true, false, true],
    ['delivery_challans', true, true, false], ['return_dc', false, true, false],
    ['delivery_register_management', false, true, false], ['payment_records', true, true, false],
    ['vendor_management', true, true, false], ['procurement', true, true, false], ['sales_pipeline', true, true, false],
    ['floor_pipeline', true, true, false], ['floor_tickets', false, true, false], ['floor_ticket_config_edit', false, true, false], ['chip_level_repair', false, true, false],
    ['qc_management', false, true, false], ['inventory', false, true, false], ['inventory_management', false, true, false],
    ['parts_inventory', true, true, false], ['parts_detach', false, true, false], ['part_vendor_repair', true, true, false], ['ttspl_history', false, false, false],
    ['warehouse', false, true, false], ['dispatch', false, true, false], ['dispatch_ops', false, true, false],
    ['customer_billing', true, true, false], ['vendor_billing_mgmt', true, true, false],
    ['credit_notes', true, true, false], ['debit_notes', true, true, false], ['security_deposits', true, true, false],
    ['billing_dashboard', false, false, false], ['einvoice_ewb', true, false, false],
    ['support_tickets', true, true, false], ['reports', false, false, false], ['reports_access', false, false, false],
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
  ],
  floor_manager: [
    ['dashboard', false, false, false], ['floor_pipeline', true, true, false], ['floor_tickets', true, true, false],
    ['floor_ticket_config_edit', false, true, false],
    ['chip_level_repair', true, true, false], ['qc_management', false, true, false],
    ['inventory', false, true, false], ['inventory_management', false, true, false], ['parts_inventory', true, true, false],
    ['parts_detach', false, true, false],
    ['part_vendor_repair', true, true, false],
    ['ttspl_history', false, false, false], ['warehouse', false, true, false], ['vendor_management', false, false, false],
    ['reports_access', false, false, false], ['production_qc_report', false, false, false],
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
    ['ttspl_history', false, false, false], ['inventory_management', false, false, false],
  ],
  procurement: [
    ['dashboard', false, false, false], ['vendor_management', true, true, false], ['procurement', true, true, false],
    ['inventory_management', false, false, false], ['parts_inventory', true, true, false],
    ['part_vendor_repair', true, true, false],
  ],
  warehouse: [
    ['dashboard', false, false, false], ['warehouse', true, true, false], ['inventory', false, true, false],
    ['inventory_management', false, true, false], ['parts_inventory', true, true, false],
    ['parts_detach', false, true, false],
    ['part_vendor_repair', true, true, false],
    ['delivery_challans', false, true, false], ['ttspl_history', false, false, false], ['vendor_management', false, false, false],
    ['support_tickets', false, false, false], ['support_work_orders', false, false, false],
    ['support_pickup_repair', false, true, false], ['support_pickup_return', false, true, false],
    ['support_replacement', false, false, false], ['support_parts_request', true, true, false],
    ['support_parts_approve', false, true, false], ['support_bucket', false, true, false],
    ['support_taxonomy', false, false, false],
  ],
  dispatch: [
    ['dashboard', false, false, false], ['dispatch', false, true, false], ['dispatch_ops', false, true, false],
    ['delivery_challans', false, true, false], ['delivery_register_management', false, true, false],
    ['technician_bucket', false, true, false],
    ['einvoice_ewb', true, true, false], ['customers', false, false, false],
    ['support_tickets', false, false, false], ['support_dashboard', false, false, false],
    ['support_work_orders', true, true, false], ['support_pickup_repair', false, true, false],
    ['support_pickup_return', false, true, false], ['support_replacement', false, true, false],
    ['support_field_visit', false, true, false], ['support_bucket', false, false, false],
    ['support_dispatch', false, true, false], ['support_taxonomy', false, false, false],
    ['support_groups', false, false, false], ['support_reports', false, false, false],
  ],
  accounts: [
    ['dashboard', false, false, false], ['customer_billing', true, true, false], ['vendor_billing_mgmt', true, true, false],
    ['credit_notes', true, false, false], ['debit_notes', true, false, false], ['security_deposits', true, true, false],
    ['billing_dashboard', false, false, false], ['einvoice_ewb', true, false, false],
    ['reports_access', false, false, false], ['production_qc_report', false, false, false],
    ['reports_export', true, false, false],
    ['customers', false, false, false], ['delivery_challans', false, false, false], ['ttspl_history', false, false, false],
    ['payment_records', true, true, false],
    ['support_tickets', false, false, false], ['support_approvals', false, false, false],
    ['support_charges', false, true, false], ['support_reports', false, false, false],
  ],
  support_lead: [
    ['dashboard', false, false, false], ['support_tickets', true, true, false], ['support_settings', false, true, false],
    ['support_technician', false, true, false], ['technician_bucket', false, true, false],
    ['sales_orders_replacement', true, true, false], ['replacement_so_laptop_qc', false, true, false],
    ['customers', false, false, false], ['customer_inventory', false, false, false], ['ttspl_history', false, false, false],
    ['support_dashboard', false, false, false], ['support_triage', false, true, false],
    ['support_work_orders', true, true, true], ['support_pickup_repair', true, true, false],
    ['support_pickup_return', true, true, false], ['support_replacement', true, false, false],
    ['support_field_visit', true, true, false], ['support_parts_request', true, true, false],
    ['support_parts_approve', false, true, false], ['support_bucket', false, false, false],
    ['support_dispatch', false, true, false], ['support_approvals', false, true, false],
    ['support_charges', true, false, false], ['support_sla_admin', false, false, false],
    ['support_taxonomy', false, false, false], ['support_groups', false, false, false],
    ['support_reports', false, false, false], ['support_customer_portal', false, false, false],
  ],
  support_tech: [
    ['dashboard', false, false, false], ['support_tickets', true, true, false],
    ['support_technician', false, true, false], ['technician_bucket', false, true, false],
    ['customers', false, false, false], ['customer_inventory', false, false, false],
    ['support_work_orders', false, false, false], ['support_pickup_repair', false, true, false],
    ['support_pickup_return', false, true, false], ['support_replacement', false, true, false],
    ['support_field_visit', false, true, false], ['support_parts_request', true, false, false],
    ['support_bucket', false, true, false], ['support_taxonomy', false, false, false],
    ['support_charges', true, false, false, false],
  ],
  support_agent: [
    ['dashboard', false, false, false],
    ['support_tickets', true, true, false], ['support_dashboard', false, false, false],
    ['support_triage', false, false, false], ['support_work_orders', false, false, false],
    ['support_pickup_repair', false, false, false], ['support_pickup_return', false, false, false],
    ['support_replacement', false, false, false], ['support_field_visit', true, false, false],
    ['support_parts_request', true, false, false], ['support_taxonomy', false, false, false],
    ['support_reports', false, false, false],
    ['customers', false, false, false],
  ],
  support_manager: [
    ['dashboard', false, false, false],
    ['support_tickets', true, true, true], ['support_dashboard', false, false, false],
    ['support_triage', false, true, false], ['support_work_orders', true, true, true],
    ['support_pickup_repair', true, true, true], ['support_pickup_return', true, true, true],
    ['support_replacement', true, true, true], ['support_field_visit', true, true, true],
    ['support_parts_request', true, true, false], ['support_parts_approve', false, true, false],
    ['support_bucket', false, false, false], ['support_dispatch', false, true, false],
    ['support_approvals', false, true, false], ['support_charges', true, true, false],
    ['support_sla_admin', false, true, false], ['support_taxonomy', true, true, false],
    ['support_groups', true, true, false], ['support_reports', false, false, false],
    ['support_settings', false, false, false], ['support_customer_portal', false, true, false],
    ['customers', false, false, false], ['customer_inventory', false, false, false],
  ],
};

function rowToPerm(section, create, edit, del) {
  return { section, can_view: true, can_create: create, can_edit: edit, can_delete: del };
}

async function seedRoleDefaults(client, role) {
  await client.query('DELETE FROM role_permissions WHERE role = $1', [role]);

  if (role === 'super_admin') {
    await client.query(
      `INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
       SELECT $1, section, true, true, true, true FROM permission_sections`,
      [role]
    );
    return;
  }

  if (role === 'admin') {
    await client.query(
      `INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
       SELECT $1, section, true, true, true,
         CASE WHEN section = ANY($2::text[]) THEN false ELSE true END
       FROM permission_sections`,
      [role, FINANCIAL_NO_DELETE]
    );
    return;
  }

  const rows = ROLE_ROW_DEFAULTS[role];
  if (!rows) return;

  for (const [section, create, edit, del, view] of rows) {
    await client.query(
      `INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [role, section, view !== false, create, edit, del]
    );
  }
}

async function applyRoleDefaults(role) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await seedRoleDefaults(client, role);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { applyRoleDefaults, seedRoleDefaults, ROLE_ROW_DEFAULTS };
