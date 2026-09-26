-- Production: one record of what a laptop's configuration was confirmed to be.
--
-- Configuration lives in several tables (vendor_serial_numbers.extra,
-- production_assets, tickets, inventory, the GRN snapshot) that drift apart.
-- This table does not replace any of them and nothing in billing reads it. It
-- is insert-only: each QC2 script match and each part fitted adds a row, so
-- "what did we last confirm, when, and how" has one answer.
CREATE TABLE IF NOT EXISTS laptop_config_confirmations (
  confirmation_id  BIGSERIAL PRIMARY KEY,
  vendor_serial_id INT REFERENCES vendor_serial_numbers(serial_id) ON DELETE SET NULL,
  ttspl_id         VARCHAR(60),
  source           VARCHAR(30) NOT NULL
                     CHECK (source IN ('qc2_script', 'dispatch_qc_script', 'part_fit', 'manual')),
  config           JSONB NOT NULL,
  ticket_id        INT,
  token_id         INT,
  confirmed_by     INT REFERENCES users(user_id) ON DELETE SET NULL,
  confirmed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes            TEXT
);
CREATE INDEX IF NOT EXISTS idx_lcc_serial ON laptop_config_confirmations (vendor_serial_id, confirmed_at DESC);
CREATE INDEX IF NOT EXISTS idx_lcc_ttspl ON laptop_config_confirmations (ttspl_id, confirmed_at DESC);
