-- 190_parts_detach_permission.sql
-- RBAC for detaching installed parts from TTSPL history back to inventory stock.

INSERT INTO permission_sections (section, description, sort_order)
VALUES ('parts_detach', 'Part Detach (Attached → Inventory)', 283)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin',       'parts_detach', true, false, true,  false),
  ('manager',     'parts_detach', true, false, true,  false),
  ('warehouse',   'parts_detach', true, false, true,  false),
  ('floor_manager','parts_detach', true, false, true, false),
  ('super_admin', 'parts_detach', true, true,  true,  true)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit,
      can_delete = EXCLUDED.can_delete;
