-- QC Process — Create Production Ticket (granular permission for QC Process list action).

UPDATE permission_sections
   SET description = 'QC Pending / Dead — move to QC Process + ticket'
 WHERE section = 'qc_move_to_ticket';

INSERT INTO permission_sections (section, description, sort_order)
VALUES (
  'qc_create_production_ticket',
  'QC Process — Create Production Ticket',
  167
)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin', 'qc_create_production_ticket', true, false, true, false),
  ('super_admin', 'qc_create_production_ticket', true, false, true, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_edit = EXCLUDED.can_edit;

-- Users who already had move-to-ticket access get create-ticket access too.
INSERT INTO user_permissions (user_id, section, can_view, can_create, can_edit, can_delete, granted_at)
SELECT up.user_id, 'qc_create_production_ticket', up.can_view, up.can_create, up.can_edit, up.can_delete, NOW()
  FROM user_permissions up
 WHERE up.section = 'qc_move_to_ticket'
   AND (up.can_edit = true OR up.can_view = true)
ON CONFLICT (user_id, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_edit = EXCLUDED.can_edit,
      granted_at = NOW();

-- Sunil Kumar — QC Process create ticket.
INSERT INTO user_permissions (user_id, section, can_view, can_create, can_edit, can_delete, granted_at)
SELECT u.user_id, 'qc_create_production_ticket', true, false, true, false, NOW()
  FROM users u
 WHERE LOWER(u.email) = 'sunil707121@gmail.com'
ON CONFLICT (user_id, section) DO UPDATE
  SET can_view = true,
      can_edit = true,
      granted_at = NOW();
