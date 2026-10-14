-- 415: Technician performance (Production → Technician performance).
--
-- A floor technician's job = a laptop whose Final Testing they finished (the
-- end of the hardware & software work: Diagnosis → Assembly & Software →
-- Final Testing). Correct jobs = jobs − those that then failed QC1, QC2 or
-- Dispatch QC; compared with a daily target for the incentive
-- (services/technicianPerformanceService). Counts come from
-- production_ticket_history; this migration only adds the targets and the
-- permission.
--
-- Additive and idempotent; not replayed by any ensure*Schema().

CREATE TABLE IF NOT EXISTS technician_performance_targets (
  id            SERIAL PRIMARY KEY,
  -- NULL = the default for every technician without their own target.
  user_id       INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
  daily_target  INTEGER NOT NULL CHECK (daily_target >= 0 AND daily_target <= 200),
  updated_by    INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_technician_performance_targets_user
  ON technician_performance_targets (COALESCE(user_id, 0));

INSERT INTO technician_performance_targets (user_id, daily_target)
SELECT NULL, 10
 WHERE NOT EXISTS (SELECT 1 FROM technician_performance_targets WHERE user_id IS NULL);

-- A new section, seeded to named roles only (an existing section must never be
-- reused to open this, see the RBAC note in 411). View = see the dashboard;
-- edit = set targets.
INSERT INTO permission_sections (section, description, sort_order, section_group) VALUES
  ('technician_performance', 'Technician performance — jobs, QC result and incentive against target', 417, 'Production')
ON CONFLICT (section) DO NOTHING;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete) VALUES
  ('admin',         'technician_performance', TRUE, FALSE, TRUE,  FALSE),
  ('manager',       'technician_performance', TRUE, FALSE, TRUE,  FALSE),
  ('floor_manager', 'technician_performance', TRUE, FALSE, TRUE,  FALSE),
  ('team_lead',     'technician_performance', TRUE, FALSE, FALSE, FALSE)
ON CONFLICT (role, section) DO NOTHING;
