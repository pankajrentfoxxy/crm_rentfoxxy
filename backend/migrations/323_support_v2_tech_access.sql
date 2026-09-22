-- ============================================================
-- Migration 219: Technician console is My jobs + My parts (D8).
-- Warehouse receipt becomes its own permission section.
-- Idempotent.
-- ============================================================

UPDATE role_permissions SET can_view = FALSE
 WHERE role IN ('support_tech', 'technician')
   AND section IN ('support_taxonomy', 'support_pickup_return', 'support_tickets', 'support_dashboard');

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete, data_scope) VALUES
  ('support_tech', 'support_bucket',        true,  false, true,  false, 'assigned'),
  ('support_tech', 'support_work_orders',   true,  false, false, false, 'assigned'),
  ('support_tech', 'support_parts_request', true,  true,  false, false, 'assigned'),
  ('technician',   'support_bucket',        true,  false, true,  false, 'assigned'),
  ('technician',   'support_work_orders',   true,  false, false, false, 'assigned'),
  ('technician',   'support_parts_request', true,  true,  false, false, 'assigned')
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view, can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit, can_delete = EXCLUDED.can_delete,
      data_scope = EXCLUDED.data_scope;

INSERT INTO permission_sections (section, description, sort_order) VALUES
  ('support_warehouse_receipt', 'Support — Warehouse receipt & goods-in', 321)
ON CONFLICT (section) DO UPDATE SET description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete, data_scope) VALUES
  ('super_admin', 'support_warehouse_receipt', true, true, true, true, 'all'),
  ('admin', 'support_warehouse_receipt', true, true, true, true, 'all'),
  ('warehouse', 'support_warehouse_receipt', true, true, true, false, 'all'),
  ('support_lead', 'support_warehouse_receipt', true, false, true, false, 'all'),
  ('support_manager', 'support_warehouse_receipt', true, true, true, false, 'all'),
  ('floor_manager', 'support_warehouse_receipt', true, false, false, false, 'all')
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view, can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit, data_scope = EXCLUDED.data_scope;
