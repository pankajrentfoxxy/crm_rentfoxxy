-- Part 5.5 (findings R9, R10) — stage seed integrity.
--
-- R9: migration 082 seeded 'Dispatch QC' at stage_order 10, which QC2 already
-- held. Two stages at the same order means every screen that sorts by
-- stage_order shows them in whatever order the planner felt like that day.
--
-- R10: 056 seeds 'Chip Level Repair' at 35 and 'Body & Paint' at 36, but the
-- live database has them at 3 and 6. So the pipeline an environment ends up with
-- depends on whether it was built from migrations or restored from a dump. Live
-- (3 and 6) is the one people actually work to, so live wins and the seed is
-- corrected to match it rather than the other way round.
--
-- R9 fix: Dispatch QC and Hold are branches off the main line, not points on it,
-- so they are numbered past Inventory instead of renumbering nine stages that
-- screens, reports and saved filters already sort by. Nothing on the main line
-- moves.
--
-- 'Hold' is seeded here because Part 5.4 needs it to exist:
-- diagnosisController sets nextStageName = 'Hold' for a security hold, looks the
-- stage up, finds nothing, updates no row — and returns success. The ticket
-- silently does not move. A stage that the code has always named should be a row.

INSERT INTO teams (team_name)
SELECT 'Hold Team'
WHERE NOT EXISTS (SELECT 1 FROM teams WHERE team_name = 'Hold Team');

INSERT INTO stages (stage_name, stage_order, stage_category, team_id, description)
SELECT 'Hold', 14, 'Warehouse',
       (SELECT team_id FROM teams WHERE team_name = 'Hold Team' ORDER BY team_id LIMIT 1),
       'Security hold. The unit is parked pending a decision and moves nowhere on its own.'
WHERE NOT EXISTS (SELECT 1 FROM stages WHERE stage_name = 'Hold');

-- Resolve the QC2 / Dispatch QC collision.
UPDATE stages SET stage_order = 13 WHERE stage_name = 'Dispatch QC' AND stage_order <> 13;
UPDATE stages SET stage_order = 14 WHERE stage_name = 'Hold'        AND stage_order <> 14;

-- Reconcile the two stages whose order depends on how the environment was built.
UPDATE stages SET stage_order = 3 WHERE stage_name = 'Chip Level Repair' AND stage_order <> 3;
UPDATE stages SET stage_order = 6 WHERE stage_name = 'Body & Paint'      AND stage_order <> 6;

-- And stop it happening again. Applied last so the fixes above clear the way.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'stages'::regclass AND conname = 'uq_stages_stage_order'
  ) THEN
    ALTER TABLE stages ADD CONSTRAINT uq_stages_stage_order UNIQUE (stage_order);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'stages'::regclass AND conname = 'uq_stages_stage_name'
  ) THEN
    ALTER TABLE stages ADD CONSTRAINT uq_stages_stage_name UNIQUE (stage_name);
  END IF;
END $$;
