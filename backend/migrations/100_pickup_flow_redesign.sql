-- ============================================================
-- Migration 100: Pickup flow redesign (Phase 20)
-- Adds pickup_type, customer OTP, warehouse e-sign and dispatch
-- tracking columns to support_ticket_items so the pickup journey
-- (Assigned -> Reached -> POD -> Customer OTP -> Warehouse e-sign)
-- can be tracked end to end. The legacy loan-machine columns are
-- kept for backward compatibility but are deprecated from the UI.
-- ============================================================

-- 1. Pickup type + new lifecycle columns on support_ticket_items
ALTER TABLE support_ticket_items
  ADD COLUMN IF NOT EXISTS pickup_type              VARCHAR(20)
    CHECK (pickup_type IS NULL OR pickup_type IN ('repair', 'return')),
  ADD COLUMN IF NOT EXISTS customer_otp_code        VARCHAR(6),
  ADD COLUMN IF NOT EXISTS customer_otp_sent_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS customer_otp_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS warehouse_received_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS warehouse_esign_url      TEXT,
  ADD COLUMN IF NOT EXISTS warehouse_esign_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS warehouse_esign_by       INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS porter_tracking_id       VARCHAR(200),
  ADD COLUMN IF NOT EXISTS porter_order_id          VARCHAR(200),
  ADD COLUMN IF NOT EXISTS return_dc_number         VARCHAR(50);

-- 2. Backfill: a pickup with an AWB was a courier return.
UPDATE support_ticket_items
SET pickup_type = 'return'
WHERE item_type = 'pickup' AND pickup_type IS NULL AND pickup_awb IS NOT NULL;

-- Everything else picked-up so far is treated as a repair pickup.
UPDATE support_ticket_items
SET pickup_type = 'repair'
WHERE item_type = 'pickup' AND pickup_type IS NULL;

-- 3. Index to quickly find a technician's active laptop bucket.
CREATE INDEX IF NOT EXISTS idx_sti_pickup_bucket
  ON support_ticket_items (pickup_assigned_to)
  WHERE item_type = 'pickup';
