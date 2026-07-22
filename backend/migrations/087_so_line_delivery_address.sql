-- PHASE 14 — Delivery address planning at the order-line level.
-- Lets addresses be set right after SO creation (before serials are attached);
-- attachSoSerial then inherits the line's address onto each serial.
ALTER TABLE sales_order_lines
  ADD COLUMN IF NOT EXISTS delivery_address JSONB,
  ADD COLUMN IF NOT EXISTS is_wfh BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS delivery_notes TEXT;

-- Index for address lookups by line
CREATE INDEX IF NOT EXISTS idx_sol_delivery_address
  ON sales_order_lines (id) WHERE delivery_address IS NOT NULL;
