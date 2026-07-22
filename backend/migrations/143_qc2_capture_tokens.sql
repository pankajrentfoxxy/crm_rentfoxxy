-- QC2 script-based config verification tokens (mirror GRN capture, keyed to Production Asset).
-- Idempotent.

CREATE TABLE IF NOT EXISTS qc2_capture_tokens (
  token_id             UUID PRIMARY KEY,
  access_number        VARCHAR(8) NOT NULL,
  ticket_id            INT NOT NULL,
  production_asset_id  INT NOT NULL,
  status               VARCHAR(20) NOT NULL DEFAULT 'pending',
  actual_config        JSONB,
  match_result         JSONB,
  serial_number        VARCHAR(120),
  verified_by_ip       VARCHAR(64),
  created_by           INT,
  expires_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  matched_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_qc2_token_ticket ON qc2_capture_tokens(ticket_id);
CREATE INDEX IF NOT EXISTS idx_qc2_token_pa ON qc2_capture_tokens(production_asset_id);
CREATE INDEX IF NOT EXISTS idx_qc2_token_status ON qc2_capture_tokens(status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_qc2_token_access_active
  ON qc2_capture_tokens(access_number)
  WHERE status = 'pending';
