-- GRN serial auto-capture tokens (open link on received laptop to push serial back)
CREATE TABLE IF NOT EXISTS grn_serial_capture_tokens (
  token_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id           INT NOT NULL REFERENCES vendor_purchase_orders(po_id),
  line_index      INT NOT NULL,
  unit_index      INT NOT NULL DEFAULT 0,
  total_units     INT NOT NULL DEFAULT 1,
  serial_number   TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'captured', 'used', 'expired', 'cancelled')),
  created_by      INT REFERENCES users(user_id),
  expires_at      TIMESTAMPTZ NOT NULL,
  captured_at     TIMESTAMPTZ,
  used_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grn_capture_tokens_po ON grn_serial_capture_tokens(po_id);
CREATE INDEX IF NOT EXISTS idx_grn_capture_tokens_status ON grn_serial_capture_tokens(status) WHERE status = 'pending';
