-- Master Vendor Data + Master Return Data: admin and super_admin only.
-- Keeps the sections visible in Role Permissions, but revokes every other role
-- and any user-level override that was copied from Master Data.

INSERT INTO permission_sections (section, description, sort_order)
VALUES
  ('inventory_vendor_master_data', 'Master Vendor Data Dashboard (Inventory Management)', 313),
  ('inventory_return_master_data', 'Master Return Data Dashboard (Inventory Management)', 314)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin', 'inventory_vendor_master_data', true, false, false, false),
  ('super_admin', 'inventory_vendor_master_data', true, false, false, false),
  ('admin', 'inventory_return_master_data', true, false, false, false),
  ('super_admin', 'inventory_return_master_data', true, false, false, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = true;

DELETE FROM role_permissions
 WHERE section IN ('inventory_vendor_master_data', 'inventory_return_master_data')
   AND role NOT IN ('admin', 'super_admin');

DELETE FROM user_permissions up
 USING users u
 WHERE up.user_id = u.user_id
   AND up.section IN ('inventory_vendor_master_data', 'inventory_return_master_data')
   AND COALESCE(u.role, '') NOT IN ('admin', 'super_admin');
