-- ============================================================
-- Migration: 096_support_v3_columns.sql
-- Ensure the support_ticket_items v3 columns exist (idempotent). Environments
-- that never ran 029_support_v3.sql (e.g. staging) were missing pod_uploaded_at /
-- warehouse_otp_code, which made the pickup POD upload fail with a 500.
-- ============================================================
ALTER TABLE support_ticket_items
  ADD COLUMN IF NOT EXISTS current_step VARCHAR(50),
  ADD COLUMN IF NOT EXISTS outcome VARCHAR(30),
  ADD COLUMN IF NOT EXISTS outcome_set_by INTEGER REFERENCES users (user_id),
  ADD COLUMN IF NOT EXISTS outcome_set_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS pod_uploaded_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS warehouse_otp_code VARCHAR(6),
  ADD COLUMN IF NOT EXISTS warehouse_otp_verified_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS pickup_method VARCHAR(20),
  ADD COLUMN IF NOT EXISTS pickup_assigned_to INTEGER REFERENCES users (user_id),
  ADD COLUMN IF NOT EXISTS pickup_courier_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS pickup_awb VARCHAR(120),
  ADD COLUMN IF NOT EXISTS pickup_completed_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMP WITH TIME ZONE;
