-- ============================================================
-- Migration 217: Support v2 charge billing (D7) + RBAC for
--   accounts billing screen and parts master price edit.
-- Idempotent.
-- ============================================================

ALTER TABLE customer_invoice_extra_lines
  ADD COLUMN IF NOT EXISTS billing_mode VARCHAR(20) NOT NULL DEFAULT 'MONTHLY',
  ADD COLUMN IF NOT EXISTS source_part_request_id INT,
  ADD COLUMN IF NOT EXISTS source_wo_id INT REFERENCES support_work_orders(wo_id),
  ADD COLUMN IF NOT EXISTS challan_number VARCHAR(40),
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS quantity INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS gst_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS accounts_note TEXT,
  ADD COLUMN IF NOT EXISTS raised_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS raised_by INT REFERENCES users(user_id);

ALTER TABLE customer_invoice_extra_lines DROP CONSTRAINT IF EXISTS cie_billing_mode_check;
ALTER TABLE customer_invoice_extra_lines ADD CONSTRAINT cie_billing_mode_check
  CHECK (billing_mode IN ('MONTHLY', 'IMMEDIATE'));

CREATE INDEX IF NOT EXISTS idx_extra_lines_mode
  ON customer_invoice_extra_lines(billing_mode, status);

INSERT INTO permission_sections (section, description, sort_order) VALUES
  ('support_charges_billing', 'Support — Accounts charge billing', 320),
  ('parts_pricing',           'Parts — Selling price edit',        283)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete) VALUES
  ('super_admin', 'support_charges_billing', true,  true,  true,  false),
  ('admin',       'support_charges_billing', true,  true,  true,  false),
  ('accounts',    'support_charges_billing', true,  true,  true,  false),
  ('support_manager', 'support_charges_billing', true, false, false, false),
  ('super_admin', 'parts_pricing', true,  false, true,  false),
  ('admin',       'parts_pricing', true,  false, true,  false),
  ('warehouse',   'parts_pricing', true,  false, true,  false),
  ('procurement', 'parts_pricing', true,  false, true,  false),
  ('manager',     'parts_pricing', true,  false, true,  false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view, can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit, can_delete = EXCLUDED.can_delete;
