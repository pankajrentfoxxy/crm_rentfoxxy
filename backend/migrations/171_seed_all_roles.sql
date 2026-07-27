-- 171: Ensure every backend role exists in the `roles` catalog table.
-- The permission-management UI (Role/User Permissions) lists roles from GET /roles,
-- which reads this table. Some roles (notably dispatch_qc) were added to the
-- users.role CHECK + role_permissions but never inserted here, so they were invisible
-- in the UI on environments that never got a manual seed. Idempotent upsert.

INSERT INTO roles (name, display_name, description, is_system_role) VALUES
  ('super_admin',   'Super Admin',         'Full unrestricted access. Can manage admins.', true),
  ('admin',         'Admin',               'Full access except super_admin actions',       true),
  ('manager',       'Manager',             'Approvals, reports, team oversight',           true),
  ('sales',         'Sales',               'Leads, quotations, sales orders, own customers', false),
  ('floor_manager', 'Floor Manager',       'Assign tickets, all floor pipeline, inventory', false),
  ('team_member',   'Technician (Floor)',  'Own assigned tickets only, parts requests',    false),
  ('team_lead',     'Senior Technician',   'Own + team tickets, can log parts',            false),
  ('qc',            'QC Inspector',        'QC1/QC2 stages only',                          false),
  ('procurement',   'Procurement',         'Purchase orders, GRN, vendor management',      false),
  ('warehouse',     'Warehouse',           'GRN receive, inventory, DC attachment',        false),
  ('dispatch',      'Dispatch',            'Delivery challans, dispatch, delivery register', false),
  ('dispatch_qc',   'Dispatch QC',         'Pre-dispatch QC inspection',                   false),
  ('accounts',      'Accounts',            'Billing, invoices, e-invoice, credit/debit notes', false),
  ('support_lead',  'Support Lead',        'All support tickets, manage support team',     false),
  ('support_tech',  'Support Technician',  'Own assigned support tickets',                 false),
  ('technician',    'Technician',          'Field / repair technician',                    true),
  ('vendor',        'Vendor',              'External vendor partner (portal)',             true),
  ('customer',      'Customer',            'Customer portal user',                         true)
ON CONFLICT (name) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      description  = EXCLUDED.description,
      is_system_role = EXCLUDED.is_system_role;
