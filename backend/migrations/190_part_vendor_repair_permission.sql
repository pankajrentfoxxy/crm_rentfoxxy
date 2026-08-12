-- Migration: 190_part_vendor_repair_permission.sql
-- Dedicated RBAC section for Inventory → Part Vendor Repair DC.

INSERT INTO permission_sections (section, description, sort_order)
VALUES (
  'part_vendor_repair',
  'Part Vendor Repair DC (return defective parts to vendor)',
  286
)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

-- Default grants for common roles
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin', 'part_vendor_repair', true, true, true, false),
  ('super_admin', 'part_vendor_repair', true, true, true, false),
  ('manager', 'part_vendor_repair', true, true, true, false),
  ('floor_manager', 'part_vendor_repair', true, true, true, false),
  ('warehouse', 'part_vendor_repair', true, true, true, false),
  ('procurement', 'part_vendor_repair', true, true, true, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit,
      can_delete = EXCLUDED.can_delete;

-- Also grant view to roles that already have parts_inventory or parts_procurement
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT DISTINCT rp.role, 'part_vendor_repair', true, false, false, false
  FROM role_permissions rp
 WHERE rp.section IN ('parts_inventory', 'parts_procurement')
   AND rp.can_view = true
ON CONFLICT (role, section) DO NOTHING;

-- Preserve user-level overrides from parts_inventory viewers
INSERT INTO user_permissions (user_id, section, can_view, can_create, can_edit, can_delete)
SELECT DISTINCT up.user_id, 'part_vendor_repair', true, false, false, false
  FROM user_permissions up
 WHERE up.section IN ('parts_inventory', 'parts_procurement')
   AND up.can_view = true
ON CONFLICT (user_id, section) DO NOTHING;
