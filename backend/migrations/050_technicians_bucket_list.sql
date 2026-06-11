-- Technicians bucket list — Laravel parity columns

ALTER TABLE public.delivery_challan_lines
  ADD COLUMN IF NOT EXISTS returned_serial_numbers JSONB;

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS delivery_person_id INT,
  ADD COLUMN IF NOT EXISTS assigned_parts JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS replaced_parts JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_delivery_challan_lines_delivery_person
  ON public.delivery_challan_lines (delivery_person_id);

CREATE INDEX IF NOT EXISTS idx_support_tickets_delivery_person
  ON public.support_tickets (delivery_person_id);

INSERT INTO public.permission_sections (section, description, sort_order)
VALUES ('technicians_bucket_list', 'Technicians bucket list', 50)
ON CONFLICT (section) DO UPDATE SET description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

INSERT INTO public.role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin', 'technicians_bucket_list', true, false, false, false),
  ('manager', 'technicians_bucket_list', true, false, false, false),
  ('sales', 'technicians_bucket_list', true, false, false, false)
ON CONFLICT (role, section) DO UPDATE SET
  can_view = EXCLUDED.can_view,
  can_create = EXCLUDED.can_create,
  can_edit = EXCLUDED.can_edit,
  can_delete = EXCLUDED.can_delete;
