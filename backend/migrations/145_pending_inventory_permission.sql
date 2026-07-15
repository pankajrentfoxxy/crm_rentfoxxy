-- 145_pending_inventory_permission.sql
-- Granular RBAC for Pending Inventory (QC2 units awaiting receive into Ready stock).

INSERT INTO permission_sections (section, description, sort_order)
VALUES ('pending_inventory', 'Pending Inventory — QC2 units awaiting serial-verified receive', 266)
ON CONFLICT (section) DO NOTHING;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('warehouse', 'pending_inventory', true, false, true, false),
  ('admin', 'pending_inventory', true, true, true, true),
  ('manager', 'pending_inventory', true, false, true, false),
  ('floor_manager', 'pending_inventory', true, false, false, false),
  ('super_admin', 'pending_inventory', true, true, true, true)
ON CONFLICT (role, section) DO NOTHING;
