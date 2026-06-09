-- ERP-style customer management (list + add with billing/shipping, docs, profile)

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS status SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS company_name VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_customers_status ON public.customers (status);
CREATE INDEX IF NOT EXISTS idx_customers_updated_at ON public.customers (updated_at DESC);

INSERT INTO public.permission_sections (section, description, sort_order)
VALUES ('customer_management', 'Customer management (ERP)', 49)
ON CONFLICT (section) DO UPDATE SET description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

INSERT INTO public.role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin', 'customer_management', true, true, true, true),
  ('manager', 'customer_management', true, true, true, true),
  ('sales', 'customer_management', true, true, true, false)
ON CONFLICT (role, section) DO UPDATE SET
  can_view = EXCLUDED.can_view,
  can_create = EXCLUDED.can_create,
  can_edit = EXCLUDED.can_edit,
  can_delete = EXCLUDED.can_delete;
