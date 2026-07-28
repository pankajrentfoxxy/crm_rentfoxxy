-- 174_so_laptop_qc_permission.sql
-- Rental/Sale SO: Laptops & QC tab + attach laptops + edit line rate/config.

INSERT INTO permission_sections (section, description, sort_order)
VALUES (
  'so_laptop_qc',
  'Sales SO — Laptops & QC (Rental/Sale)',
  49
)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

-- harshit@rentfoxxy.com — user override
INSERT INTO user_permissions (user_id, section, can_view, can_create, can_edit, can_delete, data_scope, granted_at)
SELECT u.user_id, 'so_laptop_qc', true, false, true, false, 'all', NOW()
  FROM users u
 WHERE LOWER(u.email) = 'harshit@rentfoxxy.com'
ON CONFLICT (user_id, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_edit = EXCLUDED.can_edit,
      data_scope = EXCLUDED.data_scope,
      granted_at = NOW();
