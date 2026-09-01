-- TaskFlow SSO entry from CRM navbar. View = show button and open SSO.
INSERT INTO permission_sections (section, description, sort_order)
VALUES (
  'taskflow',
  'TaskFlow — open from CRM navbar with SSO (same email, no second password)',
  20
)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT DISTINCT rp.role, 'taskflow', true, false, false, false
FROM role_permissions rp
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view;
