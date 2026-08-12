-- Migration: 187_inventory_master_data_permission.sql
-- Dedicated RBAC section for Inventory Management → Master Data Dashboard.

INSERT INTO permission_sections (section, description, sort_order)
VALUES (
  'inventory_master_data',
  'Master Data Dashboard (Inventory Management)',
  312
)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

-- Default grants: admin roles
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin', 'inventory_master_data', true, false, false, false),
  ('super_admin', 'inventory_master_data', true, false, false, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view;

-- Preserve existing access for roles that already had inventory_management view
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT DISTINCT rp.role, 'inventory_master_data', true, false, false, false
  FROM role_permissions rp
 WHERE rp.section = 'inventory_management'
   AND rp.can_view = true
ON CONFLICT (role, section) DO NOTHING;

-- Preserve existing user overrides for inventory_management view
INSERT INTO user_permissions (user_id, section, can_view, can_create, can_edit, can_delete, granted_at)
SELECT up.user_id, 'inventory_master_data', true, false, false, false, NOW()
  FROM user_permissions up
 WHERE up.section = 'inventory_management'
   AND up.can_view = true
ON CONFLICT (user_id, section) DO NOTHING;
