-- Part 5.4 (finding R6) — bound the rework loops.
--
-- qc_fail_count has been incremented since the floor pipeline was built and
-- read by nothing. QC1 <-> Assembly & Software and QC2 <-> QC1 can therefore
-- cycle forever: the same laptop fails, goes back, fails again, and no part of
-- the system notices it is the fourth time.
--
-- These columns are what "escalate at three" needs to be a fact rather than a
-- flag someone has to remember to set. security_hold gets its own pair for the
-- same reason: Part 5.4 seeds the Hold stage, and a held unit needs to say who
-- held it and why or it is just a ticket that stopped moving.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS qc_escalated_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qc_escalation_reason TEXT,
  ADD COLUMN IF NOT EXISTS security_hold_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS security_hold_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_tickets_qc_escalated
  ON tickets (qc_escalated_at)
  WHERE qc_escalated_at IS NOT NULL;
