-- Phase 10: Complete user management enhancements

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_login         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_login_ip      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS deactivated_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deactivated_by     INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS deactivation_reason TEXT,
  ADD COLUMN IF NOT EXISTS profile_photo_url  TEXT,
  ADD COLUMN IF NOT EXISTS designation        VARCHAR(100),
  ADD COLUMN IF NOT EXISTS department         VARCHAR(100),
  ADD COLUMN IF NOT EXISTS employee_id        VARCHAR(50),
  ADD COLUMN IF NOT EXISTS joining_date       DATE,
  ADD COLUMN IF NOT EXISTS notes              TEXT;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check
  CHECK (status IN ('active','pending_approval','rejected','blocked','inactive'));

INSERT INTO permission_sections (section, description, sort_order)
VALUES
  ('analytics_dashboard',   'Analytics Dashboard',     11),
  ('lead_follow_ups',        'Follow-ups',              41),
  ('lead_conversion',        'Lead Conversion',         45),
  ('customer_documents',     'Customer Documents',       85),
  ('delivery_register_management','Delivery Register',  175),
  ('payment_records',        'Payment Records',         176),
  ('floor_pipeline',         'Floor Pipeline',           25),
  ('floor_tickets',          'Floor Tickets',            26),
  ('chip_level_repair',      'Chip Level Repair',        27),
  ('parts_inventory',        'Parts Inventory',          28),
  ('ttspl_history',          'TTSPL History',            29),
  ('dispatch_ops',           'Dispatch Operations',     175),
  ('customer_billing',       'Customer Billing',        200),
  ('vendor_billing_mgmt',    'Vendor Billing',          201),
  ('credit_notes',           'Credit Notes',            202),
  ('debit_notes',            'Debit Notes',             203),
  ('security_deposits',      'Security Deposits',       204),
  ('billing_dashboard',      'Billing Dashboard',       205),
  ('einvoice_ewb',           'E-Invoice & E-Way Bill',  206),
  ('support_settings',       'Support Settings',        301),
  ('reports_access',         'Reports Access',          402),
  ('reports_export',         'Export Reports',          403),
  ('sales_pipeline',         'Sales Pipeline',           55),
  ('users',                  'User Management',         350)
ON CONFLICT (section) DO UPDATE SET
  description = EXCLUDED.description,
  sort_order  = EXCLUDED.sort_order;

INSERT INTO roles (name, display_name, description, is_system_role)
VALUES
  ('super_admin',   'Super Admin',         'Full unrestricted access',              true),
  ('admin',         'Admin',               'Full CRM access',                       true),
  ('manager',       'Manager',             'Approvals, reports, team oversight',    true),
  ('sales',         'Sales',               'Leads, quotations, sales orders',       false),
  ('floor_manager', 'Floor Manager',       'Assign tickets, floor oversight',       false),
  ('team_member',   'Technician (Floor)',  'Assigned tickets, parts requests',      false),
  ('team_lead',     'Senior Technician',   'Team tickets, parts management',        false),
  ('qc',            'QC Inspector',        'QC1/QC2 stages only',                   false),
  ('procurement',   'Procurement',         'Purchase orders, GRN, vendors',         false),
  ('warehouse',     'Warehouse',           'GRN, inventory, DC attachment',         false),
  ('dispatch',      'Dispatch',            'Delivery challans, dispatch',           false),
  ('accounts',      'Accounts',            'Billing, invoices, finance',            false),
  ('support_lead',  'Support Lead',        'All support tickets, team management',  false),
  ('support_tech',  'Support Technician',  'Own assigned support tickets',          false)
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description  = EXCLUDED.description;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT 'super_admin', section, true, true, true, true
FROM permission_sections
ON CONFLICT (role, section) DO NOTHING;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT 'admin', section, true, true, true,
  CASE WHEN section IN ('customer_billing','vendor_billing_mgmt','credit_notes',
       'debit_notes','security_deposits') THEN false ELSE true END
FROM permission_sections
ON CONFLICT (role, section) DO NOTHING;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('manager','dashboard',TRUE,FALSE,FALSE,FALSE),
  ('manager','analytics_dashboard',TRUE,FALSE,FALSE,FALSE),
  ('manager','leads',TRUE,TRUE,TRUE,FALSE),
  ('manager','lead_follow_ups',TRUE,TRUE,TRUE,FALSE),
  ('manager','lead_conversion',TRUE,TRUE,TRUE,FALSE),
  ('manager','customers',TRUE,TRUE,TRUE,FALSE),
  ('manager','customer_documents',TRUE,TRUE,TRUE,FALSE),
  ('manager','sales_quotations',TRUE,TRUE,TRUE,FALSE),
  ('manager','sales_orders_doc',TRUE,TRUE,TRUE,FALSE),
  ('manager','delivery_challans',TRUE,TRUE,TRUE,FALSE),
  ('manager','return_dc',TRUE,FALSE,TRUE,FALSE),
  ('manager','delivery_register_management',TRUE,FALSE,TRUE,FALSE),
  ('manager','payment_records',TRUE,TRUE,TRUE,FALSE),
  ('manager','vendor_management',TRUE,TRUE,TRUE,FALSE),
  ('manager','procurement',TRUE,TRUE,TRUE,FALSE),
  ('manager','sales_pipeline',TRUE,TRUE,TRUE,FALSE),
  ('manager','floor_pipeline',TRUE,TRUE,TRUE,FALSE),
  ('manager','floor_tickets',TRUE,FALSE,TRUE,FALSE),
  ('manager','chip_level_repair',TRUE,FALSE,TRUE,FALSE),
  ('manager','qc_management',TRUE,FALSE,TRUE,FALSE),
  ('manager','inventory',TRUE,FALSE,TRUE,FALSE),
  ('manager','inventory_management',TRUE,FALSE,TRUE,FALSE),
  ('manager','parts_inventory',TRUE,TRUE,TRUE,FALSE),
  ('manager','ttspl_history',TRUE,FALSE,FALSE,FALSE),
  ('manager','warehouse',TRUE,FALSE,TRUE,FALSE),
  ('manager','dispatch',TRUE,FALSE,TRUE,FALSE),
  ('manager','dispatch_ops',TRUE,FALSE,TRUE,FALSE),
  ('manager','customer_billing',TRUE,TRUE,TRUE,FALSE),
  ('manager','vendor_billing_mgmt',TRUE,TRUE,TRUE,FALSE),
  ('manager','credit_notes',TRUE,TRUE,TRUE,FALSE),
  ('manager','debit_notes',TRUE,TRUE,TRUE,FALSE),
  ('manager','security_deposits',TRUE,TRUE,TRUE,FALSE),
  ('manager','billing_dashboard',TRUE,FALSE,FALSE,FALSE),
  ('manager','einvoice_ewb',TRUE,TRUE,FALSE,FALSE),
  ('manager','support_tickets',TRUE,TRUE,TRUE,FALSE),
  ('manager','reports',TRUE,FALSE,FALSE,FALSE),
  ('manager','reports_access',TRUE,FALSE,FALSE,FALSE),
  ('manager','reports_export',TRUE,TRUE,FALSE,FALSE),
  ('manager','users',TRUE,TRUE,TRUE,FALSE),
  ('manager','teams',TRUE,TRUE,TRUE,FALSE),
  ('manager','roles',TRUE,FALSE,FALSE,FALSE),
  ('manager','role_permissions',TRUE,FALSE,TRUE,FALSE),
  ('manager','user_permissions',TRUE,FALSE,TRUE,FALSE)
ON CONFLICT (role, section) DO NOTHING;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('sales','dashboard',TRUE,FALSE,FALSE,FALSE),
  ('sales','leads',TRUE,TRUE,TRUE,FALSE),
  ('sales','lead_follow_ups',TRUE,TRUE,TRUE,FALSE),
  ('sales','lead_conversion',TRUE,TRUE,FALSE,FALSE),
  ('sales','customers',TRUE,TRUE,TRUE,FALSE),
  ('sales','customer_documents',TRUE,TRUE,FALSE,FALSE),
  ('sales','sales_quotations',TRUE,TRUE,FALSE,FALSE),
  ('sales','sales_orders_doc',TRUE,TRUE,FALSE,FALSE),
  ('sales','delivery_challans',TRUE,FALSE,FALSE,FALSE),
  ('sales','inventory',TRUE,FALSE,FALSE,FALSE),
  ('sales','inventory_management',TRUE,FALSE,FALSE,FALSE),
  ('sales','ttspl_history',TRUE,FALSE,FALSE,FALSE),
  ('sales','support_tickets',TRUE,FALSE,FALSE,FALSE),
  ('sales','reports_access',TRUE,FALSE,FALSE,FALSE)
ON CONFLICT (role, section) DO NOTHING;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('floor_manager','dashboard',TRUE,FALSE,FALSE,FALSE),
  ('floor_manager','floor_pipeline',TRUE,TRUE,TRUE,FALSE),
  ('floor_manager','floor_tickets',TRUE,TRUE,TRUE,FALSE),
  ('floor_manager','chip_level_repair',TRUE,TRUE,TRUE,FALSE),
  ('floor_manager','qc_management',TRUE,FALSE,TRUE,FALSE),
  ('floor_manager','inventory',TRUE,FALSE,TRUE,FALSE),
  ('floor_manager','inventory_management',TRUE,FALSE,TRUE,FALSE),
  ('floor_manager','parts_inventory',TRUE,TRUE,TRUE,FALSE),
  ('floor_manager','ttspl_history',TRUE,FALSE,FALSE,FALSE),
  ('floor_manager','warehouse',TRUE,FALSE,TRUE,FALSE),
  ('floor_manager','vendor_management',TRUE,FALSE,FALSE,FALSE),
  ('floor_manager','reports_access',TRUE,FALSE,FALSE,FALSE),
  ('floor_manager','support_tickets',TRUE,FALSE,FALSE,FALSE)
ON CONFLICT (role, section) DO NOTHING;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('team_member','dashboard',TRUE,FALSE,FALSE,FALSE),
  ('team_member','floor_pipeline',TRUE,FALSE,TRUE,FALSE),
  ('team_member','floor_tickets',TRUE,FALSE,TRUE,FALSE),
  ('team_member','chip_level_repair',TRUE,FALSE,TRUE,FALSE),
  ('team_member','parts_inventory',TRUE,FALSE,FALSE,FALSE),
  ('team_member','ttspl_history',TRUE,FALSE,FALSE,FALSE)
ON CONFLICT (role, section) DO NOTHING;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('team_lead','dashboard',TRUE,FALSE,FALSE,FALSE),
  ('team_lead','floor_pipeline',TRUE,TRUE,TRUE,FALSE),
  ('team_lead','floor_tickets',TRUE,TRUE,TRUE,FALSE),
  ('team_lead','chip_level_repair',TRUE,TRUE,TRUE,FALSE),
  ('team_lead','parts_inventory',TRUE,FALSE,FALSE,FALSE),
  ('team_lead','ttspl_history',TRUE,FALSE,FALSE,FALSE)
ON CONFLICT (role, section) DO NOTHING;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('qc','dashboard',TRUE,FALSE,FALSE,FALSE),
  ('qc','floor_pipeline',TRUE,FALSE,TRUE,FALSE),
  ('qc','floor_tickets',TRUE,FALSE,TRUE,FALSE),
  ('qc','qc_management',TRUE,FALSE,TRUE,FALSE),
  ('qc','ttspl_history',TRUE,FALSE,FALSE,FALSE),
  ('qc','inventory_management',TRUE,FALSE,FALSE,FALSE)
ON CONFLICT (role, section) DO NOTHING;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('procurement','dashboard',TRUE,FALSE,FALSE,FALSE),
  ('procurement','vendor_management',TRUE,TRUE,TRUE,FALSE),
  ('procurement','procurement',TRUE,TRUE,TRUE,FALSE),
  ('procurement','inventory_management',TRUE,FALSE,FALSE,FALSE),
  ('procurement','parts_inventory',TRUE,TRUE,TRUE,FALSE)
ON CONFLICT (role, section) DO NOTHING;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('warehouse','dashboard',TRUE,FALSE,FALSE,FALSE),
  ('warehouse','warehouse',TRUE,TRUE,TRUE,FALSE),
  ('warehouse','inventory',TRUE,FALSE,TRUE,FALSE),
  ('warehouse','inventory_management',TRUE,FALSE,TRUE,FALSE),
  ('warehouse','parts_inventory',TRUE,TRUE,TRUE,FALSE),
  ('warehouse','delivery_challans',TRUE,FALSE,TRUE,FALSE),
  ('warehouse','ttspl_history',TRUE,FALSE,FALSE,FALSE),
  ('warehouse','vendor_management',TRUE,FALSE,FALSE,FALSE)
ON CONFLICT (role, section) DO NOTHING;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('dispatch','dashboard',TRUE,FALSE,FALSE,FALSE),
  ('dispatch','dispatch',TRUE,FALSE,TRUE,FALSE),
  ('dispatch','dispatch_ops',TRUE,FALSE,TRUE,FALSE),
  ('dispatch','delivery_challans',TRUE,FALSE,TRUE,FALSE),
  ('dispatch','delivery_register_management',TRUE,FALSE,TRUE,FALSE),
  ('dispatch','einvoice_ewb',TRUE,FALSE,FALSE,FALSE),
  ('dispatch','customers',TRUE,FALSE,FALSE,FALSE)
ON CONFLICT (role, section) DO NOTHING;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('accounts','dashboard',TRUE,FALSE,FALSE,FALSE),
  ('accounts','customer_billing',TRUE,TRUE,TRUE,FALSE),
  ('accounts','vendor_billing_mgmt',TRUE,TRUE,TRUE,FALSE),
  ('accounts','credit_notes',TRUE,TRUE,FALSE,FALSE),
  ('accounts','debit_notes',TRUE,TRUE,FALSE,FALSE),
  ('accounts','security_deposits',TRUE,TRUE,TRUE,FALSE),
  ('accounts','billing_dashboard',TRUE,FALSE,FALSE,FALSE),
  ('accounts','einvoice_ewb',TRUE,TRUE,FALSE,FALSE),
  ('accounts','reports_access',TRUE,FALSE,FALSE,FALSE),
  ('accounts','reports_export',TRUE,TRUE,FALSE,FALSE),
  ('accounts','customers',TRUE,FALSE,FALSE,FALSE),
  ('accounts','delivery_challans',TRUE,FALSE,FALSE,FALSE),
  ('accounts','ttspl_history',TRUE,FALSE,FALSE,FALSE),
  ('accounts','payment_records',TRUE,TRUE,TRUE,FALSE)
ON CONFLICT (role, section) DO NOTHING;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('support_lead','dashboard',TRUE,FALSE,FALSE,FALSE),
  ('support_lead','support_tickets',TRUE,TRUE,TRUE,FALSE),
  ('support_lead','support_settings',TRUE,FALSE,TRUE,FALSE),
  ('support_lead','customers',TRUE,FALSE,FALSE,FALSE),
  ('support_lead','customer_inventory',TRUE,FALSE,FALSE,FALSE),
  ('support_lead','ttspl_history',TRUE,FALSE,FALSE,FALSE)
ON CONFLICT (role, section) DO NOTHING;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('support_tech','dashboard',TRUE,FALSE,FALSE,FALSE),
  ('support_tech','support_tickets',TRUE,TRUE,TRUE,FALSE),
  ('support_tech','customers',TRUE,FALSE,FALSE,FALSE),
  ('support_tech','customer_inventory',TRUE,FALSE,FALSE,FALSE)
ON CONFLICT (role, section) DO NOTHING;
