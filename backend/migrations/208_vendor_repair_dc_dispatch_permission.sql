-- Migration: 208_vendor_repair_dc_dispatch_permission.sql
-- Dedicated RBAC for signing, confirming dispatch, and marking delivered on laptop VRDC.

INSERT INTO permission_sections (section, description, sort_order)
VALUES (
  'vendor_repair_dc_dispatch',
  'Vendor Repair DC — Sign, Confirm Dispatch & Mark Delivered',
  166
)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin',         'vendor_repair_dc_dispatch', true, true, true, true),
  ('super_admin',   'vendor_repair_dc_dispatch', true, true, true, true),
  ('manager',       'vendor_repair_dc_dispatch', true, true, true, false),
  ('floor_manager', 'vendor_repair_dc_dispatch', true, true, true, false),
  ('warehouse',     'vendor_repair_dc_dispatch', true, true, true, false),
  ('support_lead',  'vendor_repair_dc_dispatch', true, true, true, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit,
      can_delete = EXCLUDED.can_delete;
