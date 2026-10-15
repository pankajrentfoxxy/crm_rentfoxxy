-- 428: receive a laptop that will not power on WITHOUT its serial number
-- (user, 15 Oct 2026). Some dead laptops have no readable serial sticker and
-- cannot run the capture script, so GRN could not book them in. Now such a
-- laptop gets its TTSPL with a placeholder serial `NOSERIAL-<TTSPL>`, and the
-- real serial is added once the laptop powers on. Until then it cannot be put
-- on an order (inventoryStateMachine refuses reserved / dispatch_ready).
--
-- New section grn_pending_serial: create = receive without a serial,
-- edit = add the serial later. Seeded to warehouse and admin (super_admin
-- passes every check); admins grant it to anyone else from Roles &
-- Permissions. Idempotent.
ALTER TABLE vendor_serial_numbers ADD COLUMN IF NOT EXISTS serial_pending BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE vendor_serial_numbers ADD COLUMN IF NOT EXISTS serial_added_at TIMESTAMPTZ;
ALTER TABLE vendor_serial_numbers ADD COLUMN IF NOT EXISTS serial_added_by INTEGER;
CREATE INDEX IF NOT EXISTS idx_vsn_serial_pending
  ON vendor_serial_numbers (serial_id) WHERE serial_pending AND deleted_at IS NULL;

INSERT INTO permission_sections (section, description, sort_order, section_group) VALUES
  ('grn_pending_serial', 'GRN without serial — receive a Not On laptop without its serial number, and add the serial later', 141, 'vendor')
ON CONFLICT (section) DO NOTHING;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete) VALUES
  ('warehouse',   'grn_pending_serial', TRUE, TRUE, TRUE, FALSE),
  ('admin',       'grn_pending_serial', TRUE, TRUE, TRUE, FALSE),
  ('super_admin', 'grn_pending_serial', TRUE, TRUE, TRUE, FALSE)
ON CONFLICT (role, section) DO NOTHING;
