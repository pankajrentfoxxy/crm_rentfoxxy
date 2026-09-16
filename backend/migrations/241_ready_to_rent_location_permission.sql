-- Ready to Rent/Sell — change warehouse carret/slot. Assignable to any role/user.

INSERT INTO permission_sections (section, description, sort_order)
VALUES (
  'ready_to_rent_location',
  'Ready to Rent/Sell — change warehouse location',
  167
)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin', 'ready_to_rent_location', true, false, true, false),
  ('super_admin', 'ready_to_rent_location', true, false, true, false),
  ('warehouse', 'ready_to_rent_location', true, false, true, false),
  ('floor_manager', 'ready_to_rent_location', true, false, true, false),
  ('manager', 'ready_to_rent_location', true, false, true, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_edit = EXCLUDED.can_edit;
