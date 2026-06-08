-- Application module sections (extends 040_rbac_roles_module.sql)
-- Safe migration: adds new sections, maps legacy section keys, seeds role defaults.

-- Upsert all application sections
INSERT INTO public.permission_sections (section, description, sort_order)
VALUES
  ('dashboard', 'Dashboard', 10),
  ('inventory', 'Inventory', 20),
  ('tickets', 'Tickets', 30),
  ('leads', 'Leads', 40),
  ('sales_orders', 'Sales Orders', 50),
  ('follow_ups', 'Follow Ups', 60),
  ('lead_orders', 'Lead Orders', 70),
  ('customers', 'Customers', 80),
  ('manager_dashboard', 'Manager Dashboard', 90),
  ('reports', 'Reports', 100),
  ('parts', 'Parts', 110),
  ('procurement', 'Procurement', 120),
  ('vendor_management', 'Vendor Management', 130),
  ('warehouse', 'Warehouse', 140),
  ('qc_management', 'QC Management', 150),
  ('inventory_management', 'Inventory Management', 160),
  ('dispatch', 'Dispatch', 170),
  ('support_tickets', 'Support Tickets', 180),
  ('customer_inventory', 'Customer Inventory', 190),
  ('teams', 'Teams', 200),
  ('roles', 'Roles', 210),
  ('role_permissions', 'Role Permissions', 220),
  ('user_permissions', 'User Permissions', 230)
ON CONFLICT (section) DO UPDATE SET
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order;

-- Map legacy section permissions to new modules (preserve existing grants)
INSERT INTO public.role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT role, 'sales_orders', can_view, can_create, can_edit, can_delete
FROM public.role_permissions WHERE section = 'orders'
ON CONFLICT (role, section) DO NOTHING;

INSERT INTO public.role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT role, 'lead_orders', can_view, can_create, can_edit, can_delete
FROM public.role_permissions WHERE section = 'orders'
ON CONFLICT (role, section) DO NOTHING;

INSERT INTO public.role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT role, 'vendor_management', can_view, can_create, can_edit, can_delete
FROM public.role_permissions WHERE section = 'catalogue'
ON CONFLICT (role, section) DO NOTHING;

INSERT INTO public.role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT role, 'roles', can_view, can_create, can_edit, can_delete
FROM public.role_permissions WHERE section = 'permissions'
ON CONFLICT (role, section) DO NOTHING;

INSERT INTO public.role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT role, 'role_permissions', can_view, false, can_edit, false
FROM public.role_permissions WHERE section = 'permissions'
ON CONFLICT (role, section) DO NOTHING;

INSERT INTO public.role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT role, 'user_permissions', can_view, false, can_edit, false
FROM public.role_permissions WHERE section = 'permissions'
ON CONFLICT (role, section) DO NOTHING;

INSERT INTO public.role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT role, 'teams', can_view, can_create, can_edit, can_delete
FROM public.role_permissions WHERE section = 'users'
ON CONFLICT (role, section) DO NOTHING;

-- Seed internal role defaults (idempotent)
INSERT INTO public.role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  -- Admin: broad internal access
  ('admin', 'dashboard', true, false, false, false),
  ('admin', 'inventory', true, true, true, true),
  ('admin', 'tickets', true, true, true, true),
  ('admin', 'leads', true, true, true, true),
  ('admin', 'sales_orders', true, true, true, true),
  ('admin', 'follow_ups', true, true, true, true),
  ('admin', 'lead_orders', true, true, true, true),
  ('admin', 'customers', true, true, true, true),
  ('admin', 'manager_dashboard', true, false, false, false),
  ('admin', 'reports', true, false, false, false),
  ('admin', 'parts', true, true, true, true),
  ('admin', 'procurement', true, true, true, true),
  ('admin', 'vendor_management', true, true, true, true),
  ('admin', 'warehouse', true, true, true, true),
  ('admin', 'qc_management', true, true, true, true),
  ('admin', 'inventory_management', true, true, true, true),
  ('admin', 'dispatch', true, true, true, true),
  ('admin', 'support_tickets', true, true, true, true),
  ('admin', 'customer_inventory', true, true, true, true),
  ('admin', 'teams', true, true, true, false),
  ('admin', 'roles', true, true, true, false),
  ('admin', 'role_permissions', true, false, true, false),
  ('admin', 'user_permissions', true, false, true, false),

  -- Manager
  ('manager', 'dashboard', true, false, false, false),
  ('manager', 'inventory', true, true, true, true),
  ('manager', 'tickets', true, true, true, true),
  ('manager', 'leads', true, true, true, true),
  ('manager', 'sales_orders', true, true, true, true),
  ('manager', 'follow_ups', true, true, true, true),
  ('manager', 'lead_orders', true, true, true, true),
  ('manager', 'customers', true, true, true, true),
  ('manager', 'manager_dashboard', true, false, false, false),
  ('manager', 'reports', true, false, false, false),
  ('manager', 'parts', true, true, true, true),
  ('manager', 'procurement', true, true, true, true),
  ('manager', 'vendor_management', true, true, true, true),
  ('manager', 'warehouse', true, true, true, true),
  ('manager', 'qc_management', true, true, true, true),
  ('manager', 'inventory_management', true, true, true, true),
  ('manager', 'dispatch', true, true, true, true),
  ('manager', 'support_tickets', true, true, true, true),
  ('manager', 'customer_inventory', true, true, true, true),
  ('manager', 'teams', true, true, true, false),

  -- Sales
  ('sales', 'dashboard', true, false, false, false),
  ('sales', 'leads', true, true, true, false),
  ('sales', 'sales_orders', true, true, true, false),
  ('sales', 'follow_ups', true, true, true, false),
  ('sales', 'lead_orders', true, true, true, false),
  ('sales', 'customers', true, true, true, false),

  -- Floor manager
  ('floor_manager', 'dashboard', true, false, false, false),
  ('floor_manager', 'inventory', true, true, true, false),
  ('floor_manager', 'tickets', true, true, true, false),
  ('floor_manager', 'reports', true, false, false, false),
  ('floor_manager', 'parts', true, true, true, false),
  ('floor_manager', 'qc_management', true, true, true, false),
  ('floor_manager', 'inventory_management', true, true, true, false),
  ('floor_manager', 'dispatch', true, true, true, false),
  ('floor_manager', 'customer_inventory', true, true, false, false),

  -- Standalone operational roles
  ('procurement', 'procurement', true, true, true, true),
  ('procurement', 'vendor_management', true, true, true, true),
  ('qc', 'qc_management', true, true, true, false),
  ('warehouse', 'warehouse', true, true, true, true),
  ('dispatch', 'dispatch', true, true, true, true),
  ('support_lead', 'support_tickets', true, true, true, true),
  ('support_lead', 'customer_inventory', true, true, true, false),
  ('support_tech', 'support_tickets', true, true, true, false),
  ('support_tech', 'customer_inventory', true, false, false, false),

  -- Team roles
  ('team_member', 'dashboard', true, false, false, false),
  ('team_member', 'tickets', true, true, true, false),
  ('team_lead', 'dashboard', true, false, false, false),
  ('team_lead', 'tickets', true, true, true, true),

  -- RBAC personas (029 seeds extended)
  ('technician', 'tickets', true, true, true, false),
  ('technician', 'inventory', true, false, false, false),
  ('technician', 'customers', true, false, false, false),
  ('vendor', 'vendor_management', true, true, true, true),
  ('customer', 'tickets', true, true, false, false),
  ('customer', 'customers', true, false, false, false)
ON CONFLICT (role, section) DO NOTHING;

-- super_admin: full access on every section
INSERT INTO public.role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT 'super_admin', ps.section, true, true, true, true
FROM public.permission_sections ps
ON CONFLICT (role, section) DO UPDATE SET
  can_view = true,
  can_create = true,
  can_edit = true,
  can_delete = true;
