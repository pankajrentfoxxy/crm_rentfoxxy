-- Migration: 200_vendor_repair_dc_permission.sql
-- Dedicated RBAC for laptop Vendor Repair DC (moved under Vendor Management).

INSERT INTO permission_sections (section, description, sort_order)
VALUES (
  'vendor_repair_dc',
  'Vendor Repair DC (send laptops to vendor for repair)',
  165
)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

-- Default grants for ops roles
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin',         'vendor_repair_dc', true, true, true, false),
  ('super_admin',   'vendor_repair_dc', true, true, true, true),
  ('manager',       'vendor_repair_dc', true, true, true, false),
  ('floor_manager', 'vendor_repair_dc', true, true, true, false),
  ('warehouse',     'vendor_repair_dc', true, true, true, false),
  ('procurement',   'vendor_repair_dc', true, true, true, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit,
      can_delete = EXCLUDED.can_delete;

-- Backfill: anyone who could view floor_pipeline or vendor_management
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT DISTINCT ON (rp.role)
       rp.role, 'vendor_repair_dc', true, rp.can_create, rp.can_edit, false
  FROM role_permissions rp
 WHERE rp.section IN ('floor_pipeline', 'vendor_management')
   AND rp.can_view = true
ON CONFLICT (role, section) DO NOTHING;

INSERT INTO user_permissions (user_id, section, can_view, can_create, can_edit, can_delete)
SELECT DISTINCT up.user_id, 'vendor_repair_dc', true, false, false, false
  FROM user_permissions up
 WHERE up.section IN ('floor_pipeline', 'vendor_management')
   AND up.can_view = true
ON CONFLICT (user_id, section) DO NOTHING;
