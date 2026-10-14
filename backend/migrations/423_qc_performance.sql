-- 423: QC inspector performance (Production → Floor performance → QC inspectors).
--
-- A QC check = a QC1, QC2 or Dispatch QC decision (pass or fail), credited to
-- whoever made it — people rotate between the three stages. A pass that later
-- proves wrong is "missed"; correct checks = checks − missed, compared with a
-- daily target for the incentive (services/qcPerformanceService). Counts come
-- from production_ticket_history; this migration only adds the targets and the
-- permission.
--
-- Targets share technician_performance_targets (415) with a kind column.
-- Additive and idempotent; not replayed by any ensure*Schema().

ALTER TABLE technician_performance_targets
  ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'technician';
ALTER TABLE technician_performance_targets
  DROP CONSTRAINT IF EXISTS technician_performance_targets_kind_check;
ALTER TABLE technician_performance_targets
  ADD CONSTRAINT technician_performance_targets_kind_check CHECK (kind IN ('technician', 'qc'));

DROP INDEX IF EXISTS uq_technician_performance_targets_user;
CREATE UNIQUE INDEX IF NOT EXISTS uq_performance_targets_kind_user
  ON technician_performance_targets (kind, COALESCE(user_id, 0));

-- QC inspectors averaged ~25–32 checks a day on QA (Sep–Oct 2026).
INSERT INTO technician_performance_targets (kind, user_id, daily_target)
SELECT 'qc', NULL, 25
 WHERE NOT EXISTS (SELECT 1 FROM technician_performance_targets WHERE kind = 'qc' AND user_id IS NULL);

-- Its own section, seeded to named roles (never reuse an existing one).
INSERT INTO permission_sections (section, description, sort_order, section_group) VALUES
  ('qc_performance', 'QC inspector performance — checks, missed defects and incentive against target', 418, 'Production')
ON CONFLICT (section) DO NOTHING;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete) VALUES
  ('admin',         'qc_performance', TRUE, FALSE, TRUE, FALSE),
  ('manager',       'qc_performance', TRUE, FALSE, TRUE, FALSE),
  ('floor_manager', 'qc_performance', TRUE, FALSE, TRUE, FALSE)
ON CONFLICT (role, section) DO NOTHING;
