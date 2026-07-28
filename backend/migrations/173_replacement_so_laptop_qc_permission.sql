-- 173_replacement_so_laptop_qc_permission.sql
-- RBAC: attach laptops + Dispatch QC on replacement sales orders (Support Lead, etc.)

INSERT INTO permission_sections (section, description, sort_order)
VALUES (
  'replacement_so_laptop_qc',
  'Replacement SO — Attach Laptop & Dispatch QC',
  48
)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

UPDATE permission_sections
   SET description = 'Sales Orders – Replacement (Support list & orders)'
 WHERE section = 'sales_orders_replacement';

-- Full replacement SO list access (support lead)
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete, data_scope)
VALUES ('support_lead', 'sales_orders_replacement', true, true, true, false, 'all')
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit,
      can_delete = EXCLUDED.can_delete,
      data_scope = EXCLUDED.data_scope;

-- Laptop attach + QC assign on replacement SO detail
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete, data_scope)
VALUES ('support_lead', 'replacement_so_laptop_qc', true, false, true, false, 'all')
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit,
      can_delete = EXCLUDED.can_delete,
      data_scope = EXCLUDED.data_scope;
