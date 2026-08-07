-- Partial sales-order line cancellation (rental / sale SO).

INSERT INTO permission_sections (section, description, sort_order)
VALUES (
  'sales_order_cancel',
  'Sales Order — partial line cancel (Rental/Sale)',
  51
)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin', 'sales_order_cancel', true, false, true, false),
  ('manager', 'sales_order_cancel', true, false, true, false),
  ('sales', 'sales_order_cancel', true, false, true, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_edit = EXCLUDED.can_edit;
