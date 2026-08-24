-- New-customer demo DC e-way bill: store date/uploader + Accounts permission.

ALTER TABLE delivery_challan_lines
  ADD COLUMN IF NOT EXISTS eway_bill_date DATE,
  ADD COLUMN IF NOT EXISTS eway_bill_uploaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS eway_bill_uploaded_by INT REFERENCES users(user_id);

CREATE INDEX IF NOT EXISTS idx_dcl_eway_uploaded
  ON delivery_challan_lines (eway_bill_uploaded_at)
  WHERE eway_bill_uploaded_at IS NOT NULL;

INSERT INTO permission_sections (section, description, sort_order)
VALUES (
  'dc_eway_bill',
  'DC E-Way Bill Management',
  207
)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('accounts', 'dc_eway_bill', true, true, true, false),
  ('admin', 'dc_eway_bill', true, true, true, false),
  ('manager', 'dc_eway_bill', true, false, false, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit,
      can_delete = EXCLUDED.can_delete;
