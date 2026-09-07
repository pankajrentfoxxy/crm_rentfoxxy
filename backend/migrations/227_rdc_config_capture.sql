-- 227: Return DC hardware config capture after guard inward (QC2 / Dispatch QC parity).

ALTER TABLE support_ticket_items
  ADD COLUMN IF NOT EXISTS return_config_token_id    UUID,
  ADD COLUMN IF NOT EXISTS return_config_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS return_config_result      JSONB,
  ADD COLUMN IF NOT EXISTS return_captured_serial    VARCHAR(120);

COMMENT ON COLUMN support_ticket_items.return_config_verified_at IS
  'Set when the Return DC hardware script matches inventory expected specs';
COMMENT ON COLUMN support_ticket_items.return_captured_serial IS
  'BIOS serial submitted by the Return DC hardware script after a config match';

CREATE TABLE IF NOT EXISTS rdc_capture_tokens (
  token_id            UUID PRIMARY KEY,
  access_number       VARCHAR(8) NOT NULL,
  rdc_number          VARCHAR(64) NOT NULL,
  item_id             INT NOT NULL REFERENCES support_ticket_items(id) ON DELETE CASCADE,
  ticket_id           INT,
  serial_id           INT,
  ttspl_id            VARCHAR(32),
  serial_number       VARCHAR(120),
  expected_config     JSONB NOT NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'pending',
  actual_config       JSONB,
  match_result        JSONB,
  verified_by_ip      VARCHAR(64),
  created_by          INT,
  expires_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  matched_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_rdcct_item   ON rdc_capture_tokens(item_id);
CREATE INDEX IF NOT EXISTS idx_rdcct_rdc    ON rdc_capture_tokens(rdc_number);
CREATE INDEX IF NOT EXISTS idx_rdcct_status ON rdc_capture_tokens(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rdcct_access_active
  ON rdc_capture_tokens(access_number) WHERE status = 'pending';
