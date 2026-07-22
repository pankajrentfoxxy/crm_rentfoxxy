-- Split Sales Orders into Sale (Gorefurbo) and Rental (Rentfoxxy) modules.
INSERT INTO permission_sections (section, description, sort_order)
VALUES
  ('sales_orders_sale', 'Sales Orders – Sale (Gorefurbo)', 45),
  ('sales_orders_rental', 'Sales Orders – Rental (Rentfoxxy)', 46)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

-- Mirror existing sales_orders_doc grants onto both new sections.
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT rp.role, 'sales_orders_sale', rp.can_view, rp.can_create, rp.can_edit, rp.can_delete
FROM role_permissions rp
WHERE rp.section = 'sales_orders_doc'
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit,
      can_delete = EXCLUDED.can_delete;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT rp.role, 'sales_orders_rental', rp.can_view, rp.can_create, rp.can_edit, rp.can_delete
FROM role_permissions rp
WHERE rp.section = 'sales_orders_doc'
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit,
      can_delete = EXCLUDED.can_delete;
