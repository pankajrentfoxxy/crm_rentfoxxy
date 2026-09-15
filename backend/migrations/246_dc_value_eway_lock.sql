-- Outbound DC e-way lock when billed value > threshold (mirrors VRDC).

ALTER TABLE delivery_challan_lines
  ADD COLUMN IF NOT EXISTS eway_required BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_dcl_eway_required_pending
  ON delivery_challan_lines (dc_number)
  WHERE eway_required = TRUE AND COALESCE(eway_bill_number, '') = '';

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('super_admin', 'dc_eway_bill', true, true, true, false),
  ('accounts', 'dc_eway_bill', true, true, true, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit;
