-- Procure to stock, step 4 (purchase orders), decision D2: an approved PO is
-- never edited silently. It is AMENDED (back to draft, then re-approved and
-- re-sent), CANCELLED (only while nothing is received) or SHORT-CLOSED (partly
-- received, no more coming), each with who, when and why.
ALTER TABLE vendor_purchase_orders
  ADD COLUMN IF NOT EXISTS amendment_no INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS amended_by INT REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS amend_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by INT REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by INT REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS close_reason TEXT;
