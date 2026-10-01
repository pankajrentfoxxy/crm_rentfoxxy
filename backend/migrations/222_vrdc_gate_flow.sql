-- 222: VRDC guard-gate flow — dispatch_ready, frozen config, receive challan heads,
-- vendor-return capture tokens. Laptop domain only. Idempotent.

-- ---------------------------------------------------------------- head
ALTER TABLE vendor_repair_delivery_challans
  ADD COLUMN IF NOT EXISTS gate_legacy BOOLEAN NOT NULL DEFAULT FALSE;

-- Everything already dispatched pre-dates the gate. Exempt it forever.
-- This file is replayed on every boot (ensureVendorRepairSchema), so a DC that
-- went out through the gate must not be swept in: without this NOT EXISTS every
-- gated DC turned legacy after the next restart and skipped the inward flow.
UPDATE vendor_repair_delivery_challans d
   SET gate_legacy = TRUE
 WHERE d.status IN ('dispatched','partially_returned','returned')
   AND d.gate_legacy = FALSE
   AND NOT EXISTS (
         SELECT 1 FROM vendor_repair_dc_items i
          WHERE i.dc_number = d.dc_number
            AND i.gate_outward_session_id IS NOT NULL
       );

-- ---------------------------------------------------------------- items
ALTER TABLE vendor_repair_dc_items
  ADD COLUMN IF NOT EXISTS dispatch_config_snapshot  JSONB,
  ADD COLUMN IF NOT EXISTS gate_outward_session_id   UUID,
  ADD COLUMN IF NOT EXISTS gate_outward_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gate_inward_session_id    UUID,
  ADD COLUMN IF NOT EXISTS gate_inward_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS return_config_token_id    UUID,
  ADD COLUMN IF NOT EXISTS return_config_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS return_config_result      JSONB;

CREATE INDEX IF NOT EXISTS idx_vrdc_items_gate_out ON vendor_repair_dc_items(gate_outward_at);
CREATE INDEX IF NOT EXISTS idx_vrdc_items_gate_in  ON vendor_repair_dc_items(gate_inward_at);

-- Snapshot the config we sent the vendor for any item still out.
UPDATE vendor_repair_dc_items i
   SET dispatch_config_snapshot = jsonb_build_object(
         'brand', vsn.extra->>'brand', 'model', vsn.extra->>'model',
         'processor', vsn.extra->>'processor', 'generation', vsn.extra->>'generation',
         'ram', vsn.extra->>'ram',
         'ssd', COALESCE(vsn.extra->>'storage', vsn.extra->>'ssd'),
         'gpu', vsn.extra->>'gpu')
  FROM vendor_serial_numbers vsn
 WHERE vsn.serial_id = i.serial_id
   AND i.dispatch_config_snapshot IS NULL
   AND COALESCE(i.item_status,'draft') NOT IN ('received','replacement_received');

-- ------------------------------------------------- receive challan head (D3)
CREATE TABLE IF NOT EXISTS vendor_repair_receive_challans (
  id                 SERIAL PRIMARY KEY,
  dc_number          VARCHAR(64) NOT NULL
                     REFERENCES vendor_repair_delivery_challans(dc_number) ON DELETE CASCADE,
  receive_dc_number  VARCHAR(80) NOT NULL UNIQUE,
  receive_mode       VARCHAR(32),
  items_count        INT NOT NULL DEFAULT 0,
  pdf_path           TEXT,
  created_by         INT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  gate_inward_at     TIMESTAMPTZ,
  gate_session_id    UUID,
  closed_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_vrrc_dc ON vendor_repair_receive_challans(dc_number);

-- Backfill one head row per existing receive number so history stays resolvable.
INSERT INTO vendor_repair_receive_challans (dc_number, receive_dc_number, items_count, created_at)
SELECT dc_number, receive_dc_number, COUNT(*)::int, COALESCE(MIN(returned_at), NOW())
  FROM vendor_repair_dc_items
 WHERE receive_dc_number IS NOT NULL
 GROUP BY dc_number, receive_dc_number
ON CONFLICT (receive_dc_number) DO NOTHING;

-- --------------------------------------- vendor return capture tokens (D2)
CREATE TABLE IF NOT EXISTS vendor_return_capture_tokens (
  token_id            UUID PRIMARY KEY,
  access_number       VARCHAR(8) NOT NULL,
  dc_number           VARCHAR(64) NOT NULL,
  receive_dc_number   VARCHAR(80),
  item_id             INT NOT NULL REFERENCES vendor_repair_dc_items(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_vrct_item   ON vendor_return_capture_tokens(item_id);
CREATE INDEX IF NOT EXISTS idx_vrct_dc     ON vendor_return_capture_tokens(dc_number);
CREATE INDEX IF NOT EXISTS idx_vrct_status ON vendor_return_capture_tokens(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vrct_access_active
  ON vendor_return_capture_tokens(access_number) WHERE status = 'pending';
