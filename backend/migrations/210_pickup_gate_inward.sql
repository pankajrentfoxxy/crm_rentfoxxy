-- 210: Guard inward stamp on support pickup items (Return DC).
-- Technician pickup (OTP) → Guard inward scan → warehouse e-sign.

ALTER TABLE support_ticket_items
  ADD COLUMN IF NOT EXISTS gate_inward_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS gate_inward_by INTEGER REFERENCES users (user_id),
  ADD COLUMN IF NOT EXISTS gate_inward_session_id UUID;

CREATE INDEX IF NOT EXISTS idx_support_ticket_items_gate_inward
  ON support_ticket_items (return_dc_number)
  WHERE return_dc_number IS NOT NULL AND gate_inward_at IS NULL;
