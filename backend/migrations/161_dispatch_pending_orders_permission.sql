-- Dispatch Pending Orders — dedicated RBAC for acceptance queue UI
INSERT INTO permission_sections (section, description, sort_order)
VALUES ('dispatch_pending_orders', 'Dispatch Pending Orders', 179)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('super_admin', 'dispatch_pending_orders', true, false, true, false),
  ('admin', 'dispatch_pending_orders', true, false, true, false),
  ('dispatch', 'dispatch_pending_orders', true, false, true, false),
  ('manager', 'dispatch_pending_orders', true, false, false, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = GREATEST(role_permissions.can_view, EXCLUDED.can_view),
      can_edit = GREATEST(role_permissions.can_edit, EXCLUDED.can_edit);
