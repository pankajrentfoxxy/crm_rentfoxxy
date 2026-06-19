-- ============================================================
-- Migration 092: GRN Hardware Configuration Verification
--   Verify the actual laptop config matches the expected GRN
--   item config BEFORE the serial number can be captured.
-- ============================================================

ALTER TABLE grn_serial_capture_tokens
  ADD COLUMN IF NOT EXISTS config_verified    BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS config_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS actual_config      JSONB,
  ADD COLUMN IF NOT EXISTS config_check       JSONB;  -- last comparison result

-- Audit log for every configuration verification attempt.
CREATE TABLE IF NOT EXISTS grn_config_verifications (
  id                    SERIAL PRIMARY KEY,
  token_id              UUID REFERENCES grn_serial_capture_tokens(token_id),
  po_id                 INT,
  line_index            INT,
  expected_config       JSONB,
  actual_config         JSONB,
  matched_fields        TEXT[],
  mismatched_fields     JSONB,
  configuration_matched BOOLEAN NOT NULL DEFAULT FALSE,
  ip                    VARCHAR(64),
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grn_config_verif_token   ON grn_config_verifications(token_id);
CREATE INDEX IF NOT EXISTS idx_grn_config_verif_created ON grn_config_verifications(created_at DESC);
