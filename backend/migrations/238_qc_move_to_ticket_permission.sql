-- QC Process / QC Pending / Dead Laptops — move laptop to floor ticket (admin by default).

INSERT INTO permission_sections (section, description, sort_order)
VALUES (
  'qc_move_to_ticket',
  'Inventory — move laptop to Production/Floor ticket',
  166
)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin', 'qc_move_to_ticket', true, false, true, false),
  ('super_admin', 'qc_move_to_ticket', true, false, true, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_edit = EXCLUDED.can_edit;

-- Sunil Kumar — move to ticket on QC Process, QC Pending, Dead Laptops.
INSERT INTO user_permissions (user_id, section, can_view, can_create, can_edit, can_delete, granted_at)
SELECT u.user_id, 'qc_move_to_ticket', true, false, true, false, NOW()
  FROM users u
 WHERE LOWER(u.email) = 'sunil707121@gmail.com'
ON CONFLICT (user_id, section) DO UPDATE
  SET can_view = true,
      can_edit = true,
      granted_at = NOW();
