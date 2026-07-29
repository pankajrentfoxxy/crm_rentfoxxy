-- 176_so_laptop_qc_role_permissions.sql
-- Assignable RBAC for rental/sale SO Laptops & QC + line config/rate edit.

INSERT INTO permission_sections (section, description, sort_order)
VALUES (
  'so_line_rate_config_edit',
  'Sales SO — Edit Line Config & Rate (Rental/Sale)',
  50
)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

UPDATE permission_sections
   SET description = 'Sales SO — Laptops & QC Tab (Rental/Sale attach + QC)'
 WHERE section = 'so_laptop_qc';

-- Full Laptops & QC tab: attach laptops, QC flow, config/rate edit
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin', 'so_laptop_qc', true, false, true, false),
  ('manager', 'so_laptop_qc', true, false, true, false),
  ('sales', 'so_laptop_qc', true, false, true, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit,
      can_delete = EXCLUDED.can_delete;

-- Config/rate edit only (overview + laptops tab) without requiring full SO edit
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin', 'so_line_rate_config_edit', true, false, true, false),
  ('manager', 'so_line_rate_config_edit', true, false, true, false),
  ('sales', 'so_line_rate_config_edit', true, false, true, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit,
      can_delete = EXCLUDED.can_delete;

-- Legacy users.permissions[] grant -> user_permissions row
INSERT INTO user_permissions (user_id, section, can_view, can_create, can_edit, can_delete, data_scope, granted_at)
SELECT u.user_id, 'so_line_rate_config_edit', true, false, true, false, 'all', NOW()
  FROM users u
 WHERE 'so_line_rate_config_edit' = ANY(COALESCE(u.permissions, ARRAY[]::text[]))
ON CONFLICT (user_id, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_edit = EXCLUDED.can_edit,
      data_scope = EXCLUDED.data_scope,
      granted_at = NOW();
