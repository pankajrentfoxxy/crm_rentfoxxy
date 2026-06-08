-- RBAC roles catalog, permission sections, audit logs (extends 029_rbac_system.sql)

CREATE TABLE IF NOT EXISTS public.roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  display_name VARCHAR(100) NOT NULL,
  description TEXT,
  is_system_role BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.permission_sections (
  id SERIAL PRIMARY KEY,
  section VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.permission_audit_logs (
  id SERIAL PRIMARY KEY,
  actor_user_id INT REFERENCES public.users (user_id) ON DELETE SET NULL,
  target_type VARCHAR(32) NOT NULL,
  target_id VARCHAR(100),
  action VARCHAR(64) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_permission_audit_logs_created ON public.permission_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_permission_audit_logs_target ON public.permission_audit_logs (target_type, target_id);

INSERT INTO public.roles (name, display_name, description, is_system_role)
VALUES
  ('super_admin', 'Super Admin', 'Full system access', true),
  ('admin', 'Admin', 'Administrative access', true),
  ('technician', 'Technician', 'Field / repair technician', true),
  ('vendor', 'Vendor', 'External vendor partner', true),
  ('customer', 'Customer', 'Customer portal user', true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.permission_sections (section, description, sort_order)
VALUES
  ('tickets', 'Ticket management', 10),
  ('inventory', 'Inventory access', 20),
  ('customers', 'Customer records', 30),
  ('reports', 'Reports and analytics', 40),
  ('catalogue', 'Product catalogue', 50),
  ('orders', 'Orders', 60),
  ('dispatch', 'Dispatch operations', 70),
  ('procurement', 'Procurement', 80),
  ('users', 'User management', 90),
  ('permissions', 'Roles and permissions', 100),
  ('invoices', 'Invoices', 110)
ON CONFLICT (section) DO NOTHING;
