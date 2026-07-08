-- 137_dispatch_qc_permission.sql
-- Granular RBAC for pre-dispatch QC (assign list + pass/fail actions).

INSERT INTO permission_sections (section, description, sort_order)
VALUES ('dispatch_qc', 'Dispatch QC — pre-dispatch inspection before DC', 265)
ON CONFLICT (section) DO NOTHING;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('dispatch_qc', 'dispatch_qc', true, false, true, false),
  ('qc', 'dispatch_qc', true, false, true, false),
  ('floor_manager', 'dispatch_qc', true, false, true, false),
  ('admin', 'dispatch_qc', true, true, true, true),
  ('manager', 'dispatch_qc', true, false, true, false)
ON CONFLICT (role, section) DO NOTHING;
