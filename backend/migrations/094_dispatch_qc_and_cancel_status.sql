-- ============================================================
-- Migration: 094_dispatch_qc_and_cancel_status.sql
-- 1) Ensure the "Dispatch QC" stage/team exist so sales_order_qc tickets route
--    there (not QC2). (Re-asserts migration 082 idempotently for envs that
--    never ran it, e.g. staging.)
-- 2) Allow ticket status 'cancelled' — detaching a serial from a Sales Order
--    cancels its pre-dispatch QC ticket, which previously violated
--    tickets_status_check.
-- ============================================================
INSERT INTO teams (team_name)
SELECT 'Dispatch QC Team'
WHERE NOT EXISTS (SELECT 1 FROM teams WHERE team_name = 'Dispatch QC Team');

INSERT INTO stages (stage_name, stage_order, stage_category, team_id, description)
SELECT 'Dispatch QC', 10, 'QC Team',
  (SELECT team_id FROM teams WHERE team_name = 'Dispatch QC Team' LIMIT 1),
  'Final QC before Sales Order dispatch. Only for sales_order_qc tickets.'
WHERE NOT EXISTS (SELECT 1 FROM stages WHERE stage_name = 'Dispatch QC');

ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_status_check
  CHECK (status IN ('in_progress', 'completed', 'failed', 'on_hold', 'qc_failed_return_vendor', 'cancelled'));
