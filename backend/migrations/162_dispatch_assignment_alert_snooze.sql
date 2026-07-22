-- Dispatch assignment center alert — snooze + defer remark

ALTER TABLE dispatch_workflow_config
  ADD COLUMN IF NOT EXISTS alert_snooze_minutes INT NOT NULL DEFAULT 5;

ALTER TABLE dispatch_workflow
  ADD COLUMN IF NOT EXISTS alert_snoozed_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_decline_remark TEXT;

CREATE INDEX IF NOT EXISTS idx_dw_alert_snooze
  ON dispatch_workflow (assigned_user_id, alert_snoozed_until)
  WHERE status = 'waiting_acceptance';
