-- Support Lead: view/edit all replacement sales orders only (not full rental/sale SO lists).
INSERT INTO permission_sections (section, description, sort_order)
VALUES ('sales_orders_replacement', 'Sales Orders – Replacement (Support)', 47)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete, data_scope)
VALUES ('support_lead', 'sales_orders_replacement', true, true, true, false, 'all')
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit,
      can_delete = EXCLUDED.can_delete,
      data_scope = EXCLUDED.data_scope;
