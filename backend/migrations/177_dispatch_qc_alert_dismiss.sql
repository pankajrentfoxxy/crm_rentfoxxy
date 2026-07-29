-- 177_dispatch_qc_alert_dismiss.sql
-- Dispatch QC reminder: permanently dismiss popup with remark (no repeat alerts).

ALTER TABLE dispatch_workflow
  ADD COLUMN IF NOT EXISTS qc_alert_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS qc_alert_dismiss_remark TEXT,
  ADD COLUMN IF NOT EXISTS qc_alert_dismissed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qc_alert_dismissed_by INTEGER;
