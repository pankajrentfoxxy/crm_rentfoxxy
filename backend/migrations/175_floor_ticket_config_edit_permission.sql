-- 175_floor_ticket_config_edit_permission.sql
-- Granular permission: edit laptop config (brand/model/processor/RAM/SSD) on floor tickets.

INSERT INTO permission_sections (section, description, sort_order)
VALUES (
  'floor_ticket_config_edit',
  'Floor Tickets — Edit laptop configuration',
  27
)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin', 'floor_ticket_config_edit', true, false, true, false),
  ('floor_manager', 'floor_ticket_config_edit', true, false, true, false),
  ('manager', 'floor_ticket_config_edit', true, false, true, false),
  ('team_lead', 'floor_ticket_config_edit', true, false, true, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_edit = EXCLUDED.can_edit;
