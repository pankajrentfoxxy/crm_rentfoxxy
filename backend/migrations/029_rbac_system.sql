-- RBAC: user status/type columns, role_permissions, user_permissions

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS user_type VARCHAR(20) DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES public.users (user_id),
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS company_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS gst_number VARCHAR(50);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_status_check'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_status_check
      CHECK (status IN ('active', 'pending_approval', 'rejected', 'blocked'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_user_type_check'
      AND conrelid = 'public.users'::regclass
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_user_type_check
      CHECK (user_type IN ('internal', 'customer', 'vendor', 'technician'));
  END IF;
END $$;

-- Extend allowed roles for RBAC personas
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'users'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (
    role IN (
      'super_admin',
      'admin',
      'manager',
      'team_member',
      'team_lead',
      'sales',
      'floor_manager',
      'procurement',
      'qc',
      'dispatch',
      'warehouse',
      'accounts',
      'support_lead',
      'support_tech',
      'dispatch_qc',
      'customer',
      'vendor',
      'technician'
    )
  );

CREATE TABLE IF NOT EXISTS public.role_permissions (
  id SERIAL PRIMARY KEY,
  role VARCHAR(50) NOT NULL,
  section VARCHAR(100) NOT NULL,
  can_view BOOLEAN DEFAULT false,
  can_create BOOLEAN DEFAULT false,
  can_edit BOOLEAN DEFAULT false,
  can_delete BOOLEAN DEFAULT false,
  UNIQUE (role, section)
);

CREATE TABLE IF NOT EXISTS public.user_permissions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES public.users (user_id) ON DELETE CASCADE,
  section VARCHAR(100) NOT NULL,
  can_view BOOLEAN,
  can_create BOOLEAN,
  can_edit BOOLEAN,
  can_delete BOOLEAN,
  granted_by INTEGER REFERENCES public.users (user_id),
  granted_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, section)
);

-- Seed role_permissions (idempotent)
INSERT INTO public.role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('technician', 'tickets', true, true, true, false),
  ('technician', 'inventory', true, false, false, false),
  ('technician', 'customers', true, false, false, false),
  ('vendor', 'catalogue', true, true, true, true),
  ('vendor', 'orders', true, false, false, false),
  ('customer', 'tickets', true, true, false, false),
  ('customer', 'invoices', true, false, false, false),
  ('admin', 'users', true, true, true, false),
  ('admin', 'permissions', true, false, true, false)
ON CONFLICT (role, section) DO NOTHING;

INSERT INTO public.role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT
  'super_admin',
  s.section,
  true,
  true,
  true,
  true
FROM (
  VALUES
    ('tickets'),
    ('inventory'),
    ('customers'),
    ('catalogue'),
    ('orders'),
    ('invoices'),
    ('users'),
    ('permissions'),
    ('reports')
) AS s (section)
ON CONFLICT (role, section) DO NOTHING;
