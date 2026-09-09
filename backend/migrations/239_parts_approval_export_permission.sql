-- Migration: 239_parts_approval_export_permission.sql
-- Granular RBAC for Parts Approval CSV export (Role Permissions UI).

INSERT INTO permission_sections (section, description, sort_order)
VALUES (
  'parts_approval_export',
  'Parts Approval — Export CSV',
  283
)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

-- Default grants for roles that already manage parts approval
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT rp.role, 'parts_approval_export', rp.can_view, false, false, false
  FROM role_permissions rp
 WHERE rp.section = 'parts_approval'
   AND rp.can_view = true
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('super_admin', 'parts_approval_export', true, false, false, false),
  ('admin', 'parts_approval_export', true, false, false, false),
  ('manager', 'parts_approval_export', true, false, false, false),
  ('warehouse', 'parts_approval_export', true, false, false, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view;

-- User overrides: mirror parts_approval viewers
INSERT INTO user_permissions (user_id, section, can_view, can_create, can_edit, can_delete)
SELECT DISTINCT up.user_id, 'parts_approval_export', true, false, false, false
  FROM user_permissions up
 WHERE up.section = 'parts_approval'
   AND up.can_view = true
ON CONFLICT (user_id, section) DO NOTHING;
