-- Delivery rejection: customer refused + warehouse return confirmation
ALTER TABLE delivery_challan_lines
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejection_source VARCHAR(32),
  ADD COLUMN IF NOT EXISTS rejection_remarks TEXT,
  ADD COLUMN IF NOT EXISTS warehouse_return_otp VARCHAR(8),
  ADD COLUMN IF NOT EXISTS warehouse_return_otp_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS warehouse_return_otp_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS warehouse_return_verified_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS return_to_warehouse_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_dcl_rejected_at ON delivery_challan_lines(rejected_at DESC)
  WHERE status = 'rejected';
