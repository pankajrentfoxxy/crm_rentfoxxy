-- Delivery Register Management — POD fields, status parity, technicians, RBAC section

ALTER TABLE public.delivery_challan_lines DROP CONSTRAINT IF EXISTS delivery_challan_lines_status_check;
ALTER TABLE public.delivery_challan_lines
  ADD CONSTRAINT delivery_challan_lines_status_check
  CHECK (status IN ('pending', 'shipped', 'processing', 'delivered', 'rejected', 'cancelled'));

ALTER TABLE public.delivery_challan_lines
  ADD COLUMN IF NOT EXISTS date_and_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS latitude VARCHAR(64),
  ADD COLUMN IF NOT EXISTS longitude VARCHAR(64),
  ADD COLUMN IF NOT EXISTS old_rejected_serial_numbers JSONB;

CREATE INDEX IF NOT EXISTS idx_delivery_challan_lines_status ON public.delivery_challan_lines (status);

-- Laravel delivery_mans parity
CREATE TABLE IF NOT EXISTS delivery_technicians (
  technician_id SERIAL PRIMARY KEY,
  user_id INT REFERENCES public.users(user_id) ON DELETE SET NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100),
  phone VARCHAR(50),
  email VARCHAR(255),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_technicians_active ON delivery_technicians (is_active);

INSERT INTO public.permission_sections (section, description, sort_order)
VALUES ('delivery_register_management', 'Delivery register management', 49)
ON CONFLICT (section) DO UPDATE SET description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

INSERT INTO public.role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin', 'delivery_register_management', true, true, true, true),
  ('manager', 'delivery_register_management', true, true, true, false),
  ('sales', 'delivery_register_management', true, false, true, false)
ON CONFLICT (role, section) DO UPDATE SET
  can_view = EXCLUDED.can_view,
  can_create = EXCLUDED.can_create,
  can_edit = EXCLUDED.can_edit,
  can_delete = EXCLUDED.can_delete;
