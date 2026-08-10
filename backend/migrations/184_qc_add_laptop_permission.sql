-- QC Process — allow selected users to add laptops directly (admin-only by default).

INSERT INTO permission_sections (section, description, sort_order)
VALUES (
  'qc_add_laptop',
  'QC Process — add new laptop',
  165
)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin', 'qc_add_laptop', true, false, true, false),
  ('super_admin', 'qc_add_laptop', true, false, true, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_edit = EXCLUDED.can_edit;

-- dispatch_1@rentfoxxy.com — add laptop on QC Process / QC Pending pages.
INSERT INTO user_permissions (user_id, section, can_view, can_create, can_edit, can_delete, granted_at)
SELECT u.user_id, 'qc_add_laptop', true, false, true, false, NOW()
  FROM users u
 WHERE LOWER(u.email) = 'dispatch_1@rentfoxxy.com'
ON CONFLICT (user_id, section) DO UPDATE
  SET can_view = true,
      can_edit = true,
      granted_at = NOW();
