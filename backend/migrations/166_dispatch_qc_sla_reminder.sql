-- Dispatch QC SLA reminder (popup after laptop attach) — 5 min for testing; prod default was 120.

UPDATE dispatch_workflow_config
   SET qc_eta_minutes = 5,
       updated_at = NOW()
 WHERE id = 1;

ALTER TABLE dispatch_workflow
  ADD COLUMN IF NOT EXISTS qc_last_reminder_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qc_alert_snoozed_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qc_alert_snooze_remark TEXT;

CREATE INDEX IF NOT EXISTS idx_dw_qc_alert
  ON dispatch_workflow (assigned_user_id, qc_due_at)
  WHERE status = 'dispatch_qc';

-- Reset active Dispatch QC SLAs to 4 minutes from now (local testing).
UPDATE dispatch_workflow
   SET qc_due_at = NOW() + interval '4 minutes',
       qc_overdue = FALSE,
       qc_last_reminder_at = NULL,
       qc_alert_snoozed_until = NULL,
       updated_at = NOW()
 WHERE status = 'dispatch_qc'
   AND qc_started_at IS NOT NULL;
