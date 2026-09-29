-- 409: "Assign floor tickets" — who may give a production ticket to someone
-- else, or reassign it.
--
-- Until now only the roles in qcGateService MANAGER_ROLES (floor_manager,
-- manager, admin, super_admin) could. This section lets the Roles &
-- Permissions screen give the same power to anyone else (edit = assign /
-- reassign). It is seeded to exactly today's roles, so nobody gains or loses
-- access by this migration; super_admin passes every check without a row.
-- Additive and idempotent: an existing grant is never overwritten.

INSERT INTO permission_sections (section, description, sort_order, section_group, hidden)
VALUES ('floor_ticket_assign', 'Assign / reassign floor tickets to anyone (floor manager power)', 27, 'floor', false)
ON CONFLICT (section) DO NOTHING;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('floor_manager', 'floor_ticket_assign', true, false, true, false),
  ('manager',       'floor_ticket_assign', true, false, true, false),
  ('admin',         'floor_ticket_assign', true, false, true, false)
ON CONFLICT (role, section) DO NOTHING;
