-- 427: "My performance" for floor technicians and QC inspectors (user,
-- 15 Oct 2026). Their own jobs / checks, QC result, correct vs target and
-- incentive standing — the same numbers managers see on Floor performance,
-- for the signed-in person only (routes/myPerformance.js never takes a user
-- id). New section, seeded to named roles. Idempotent.
INSERT INTO permission_sections (section, description, sort_order, section_group) VALUES
  ('my_performance', 'My performance — my own jobs / QC checks, QC result and incentive against target', 421, 'Production')
ON CONFLICT (section) DO NOTHING;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete) VALUES
  ('team_member', 'my_performance', TRUE, FALSE, FALSE, FALSE),
  ('team_lead',   'my_performance', TRUE, FALSE, FALSE, FALSE),
  ('qc',          'my_performance', TRUE, FALSE, FALSE, FALSE)
ON CONFLICT (role, section) DO NOTHING;
