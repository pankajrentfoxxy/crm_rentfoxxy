-- 425: floor work counts on the Today page (user, 15 Oct 2026).
--
-- "Every floor technician can see the count of their tickets / tasks on the
-- dashboard, and the floor manager can see all team members' counts."
--
--   floor_my_work    my own counts: assigned to me (by stage), waiting for
--                    Start work, timer running, sent back by QC, stages and
--                    laptops finished on the day, QC checks made
--   floor_team_work  the same counts for every floor team member
--
-- Counts come from tickets / work_logs / production_ticket_history
-- (services/floorWorkService). New sections, seeded to named roles only.
-- Additive and idempotent.

INSERT INTO permission_sections (section, description, sort_order, section_group) VALUES
  ('floor_my_work',   'Today page — my floor work counts (assigned, waiting, timer, sent back by QC, done)', 419, 'Production'),
  ('floor_team_work', 'Today page — every floor team member''s work counts', 420, 'Production')
ON CONFLICT (section) DO NOTHING;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete) VALUES
  ('team_member',   'floor_my_work',   TRUE, FALSE, FALSE, FALSE),
  ('team_lead',     'floor_my_work',   TRUE, FALSE, FALSE, FALSE),
  ('qc',            'floor_my_work',   TRUE, FALSE, FALSE, FALSE),
  ('floor_manager', 'floor_team_work', TRUE, FALSE, FALSE, FALSE),
  ('manager',       'floor_team_work', TRUE, FALSE, FALSE, FALSE),
  ('admin',         'floor_team_work', TRUE, FALSE, FALSE, FALSE)
ON CONFLICT (role, section) DO NOTHING;
