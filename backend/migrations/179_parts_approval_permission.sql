-- 179_parts_approval_permission.sql
-- Expose Parts Approval as assignable RBAC; grant accounts role warehouse-queue access.

INSERT INTO permission_sections (section, description, sort_order)
VALUES
  ('parts_requests',    'Part Requests (Floor)',             280),
  ('parts_approval',    'Parts Approval',                    281),
  ('parts_procurement', 'Parts Procurement',                 282)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin',         'parts_approval', true, true,  true,  true),
  ('manager',       'parts_approval', true, true,  true,  false),
  ('warehouse',     'parts_approval', true, false, true,  false),
  ('accounts',      'parts_approval', true, false, true,  false),
  ('super_admin',   'parts_approval', true, true,  true,  true)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit,
      can_delete = EXCLUDED.can_delete;
