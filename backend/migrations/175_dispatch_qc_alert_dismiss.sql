-- Dispatch QC reminder: allow permanently rejecting/skipping the reminder with a remark.
-- Once dismissed, the popup/notification will not fire again for that order (even after snooze windows).

ALTER TABLE dispatch_workflow
  ADD COLUMN IF NOT EXISTS qc_alert_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS qc_alert_dismiss_remark TEXT,
  ADD COLUMN IF NOT EXISTS qc_alert_dismissed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qc_alert_dismissed_by INTEGER;
