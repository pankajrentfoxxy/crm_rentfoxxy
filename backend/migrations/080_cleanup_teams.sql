-- ============================================================
-- Migration: 080_cleanup_teams.sql
-- Fix the team picker (Add/Edit User):
--   1. Remove duplicate team rows (a seed re-run created a second copy
--      of Hardware & Software, QC1, QC2, Chip Level Repair, Inventory,
--      Body & Paint, Warehouse — ids 85-91, all with zero references).
--   2. Remove the Hardware & Software SUB-STAGE teams that should not be
--      assignable (Diagnose, Assembly & Software, Testing) — those stages
--      belong to the single "Hardware & Software" team (stages already
--      point to it). Also drop the redundant generic "QC Team".
--   3. Rename "Vendor (Body & Paint)" -> "Body & Paint Team".
-- All deleted rows are verified to have 0 references in
-- users / user_teams / stages / tickets / qc_round_robin_state.
-- ============================================================

-- Safety: only delete rows that truly have no references anywhere.
DELETE FROM teams t
WHERE t.team_id IN (
  -- duplicates
  85, 86, 87, 88, 89, 90, 91,
  -- H&S sub-stage teams (the real stages use team "Hardware & Software")
  2,  -- Diagnose Team
  7,  -- Assembly & Software Team
  8,  -- Testing Team
  -- redundant generic team
  12  -- QC Team
)
AND NOT EXISTS (SELECT 1 FROM users u            WHERE u.team_id = t.team_id)
AND NOT EXISTS (SELECT 1 FROM user_teams ut      WHERE ut.team_id = t.team_id)
AND NOT EXISTS (SELECT 1 FROM stages s           WHERE s.team_id = t.team_id)
AND NOT EXISTS (SELECT 1 FROM tickets tk         WHERE tk.assigned_team_id = t.team_id)
AND NOT EXISTS (SELECT 1 FROM qc_round_robin_state q WHERE q.team_id = t.team_id);

-- Clarify the Body & Paint team name (it is the body & paint stage owner)
UPDATE teams SET team_name = 'Body & Paint Team'
WHERE team_id = 6 AND team_name = 'Vendor (Body & Paint)';
