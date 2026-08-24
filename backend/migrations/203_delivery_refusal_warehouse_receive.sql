-- Customer refusal at delivery -> warehouse "Receive Back" with e-signature.
--
-- Mirrors the support Return DC warehouse-inward columns (support_ticket_items:
-- warehouse_received_at / _by / warehouse_esign_url / warehouse_esign_name) onto the
-- outbound challan line so the same receive-with-e-sign inward closes a refused
-- delivery. Purely additive: migration 120 already added the rejection +
-- return_to_warehouse_at columns used by the OTP return path.

ALTER TABLE delivery_challan_lines
  ADD COLUMN IF NOT EXISTS warehouse_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS warehouse_received_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS warehouse_receiver_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS warehouse_esign_url TEXT,
  ADD COLUMN IF NOT EXISTS warehouse_receive_remarks TEXT;

-- "Refused - awaiting warehouse receipt" bucket, and the sales-order cancel guard
-- that has to prove every challan line came back.
CREATE INDEX IF NOT EXISTS idx_dcl_refused_awaiting_warehouse
  ON delivery_challan_lines (sales_order_number)
  WHERE status = 'rejected' AND return_to_warehouse_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_dcl_warehouse_received_at
  ON delivery_challan_lines (warehouse_received_at)
  WHERE warehouse_received_at IS NOT NULL;
