-- Dedicated RBAC section for Inventory Management → Master Vendor Data.

INSERT INTO permission_sections (section, description, sort_order)
VALUES (
  'inventory_vendor_master_data',
  'Master Vendor Data Dashboard (Inventory Management)',
  313
)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin', 'inventory_vendor_master_data', true, false, false, false),
  ('super_admin', 'inventory_vendor_master_data', true, false, false, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT DISTINCT rp.role, 'inventory_vendor_master_data', true, false, false, false
  FROM role_permissions rp
 WHERE rp.section IN ('inventory_master_data', 'inventory_management')
   AND rp.can_view = true
ON CONFLICT (role, section) DO NOTHING;

INSERT INTO user_permissions (user_id, section, can_view, can_create, can_edit, can_delete, granted_at)
SELECT up.user_id, 'inventory_vendor_master_data', true, false, false, false, NOW()
  FROM user_permissions up
 WHERE up.section IN ('inventory_master_data', 'inventory_management')
   AND up.can_view = true
ON CONFLICT (user_id, section) DO NOTHING;
