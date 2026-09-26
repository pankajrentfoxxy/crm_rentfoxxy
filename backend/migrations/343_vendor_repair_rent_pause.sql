-- Vendor repair challan: rent pause while a laptop is with the vendor for
-- repair, replacement check + approval, "vendor keeps it"
-- (claude/carret-vendor-repair.md). Additive only.

-- One row per laptop per repair. Paused from the stop date the vendor was
-- mailed; resumed_on (billed again from that day) is the gate-in date. A pause
-- closed as replaced / vendor_kept never resumes — the laptop's rent ends the
-- day before paused_from. A cancelled pause is ignored by billing.
CREATE TABLE IF NOT EXISTS vendor_rent_pauses (
  id            SERIAL PRIMARY KEY,
  serial_id     INTEGER NOT NULL REFERENCES vendor_serial_numbers(serial_id),
  paused_from   DATE NOT NULL,
  resumed_on    DATE,
  source        VARCHAR(40) NOT NULL DEFAULT 'vendor_repair',
  source_ref    VARCHAR(80),
  item_id       INTEGER,
  closed_reason VARCHAR(20),
  created_by    INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT vendor_rent_pauses_dates CHECK (resumed_on IS NULL OR resumed_on >= paused_from),
  CONSTRAINT vendor_rent_pauses_closed CHECK (closed_reason IS NULL OR closed_reason IN ('resumed', 'replaced', 'vendor_kept', 'cancelled'))
);
CREATE INDEX IF NOT EXISTS vendor_rent_pauses_serial_idx ON vendor_rent_pauses (serial_id);
-- At most one open pause per laptop.
CREATE UNIQUE INDEX IF NOT EXISTS vendor_rent_pauses_one_open
  ON vendor_rent_pauses (serial_id) WHERE closed_reason IS NULL;

ALTER TABLE vendor_repair_delivery_challans
  ADD COLUMN IF NOT EXISTS rent_stop_date DATE,
  ADD COLUMN IF NOT EXISTS vendor_notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vendor_notified_by INTEGER,
  ADD COLUMN IF NOT EXISTS notify_to TEXT,
  ADD COLUMN IF NOT EXISTS notify_cc TEXT,
  ADD COLUMN IF NOT EXISTS notify_error TEXT,
  ADD COLUMN IF NOT EXISTS request_pdf_path TEXT,
  ADD COLUMN IF NOT EXISTS cancel_mail_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS porter_person_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS porter_person_phone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS inhouse_person_phone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS eway_auto_mail_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS eway_auto_mail_error TEXT;

ALTER TABLE vendor_repair_dc_items
  ADD COLUMN IF NOT EXISTS issue_type VARCHAR(40),
  ADD COLUMN IF NOT EXISTS rent_paused_from DATE,
  ADD COLUMN IF NOT EXISTS rent_resumed_on DATE,
  -- Replacement check (script) and approval
  ADD COLUMN IF NOT EXISTS replacement_check_token_id UUID,
  ADD COLUMN IF NOT EXISTS replacement_captured_serial VARCHAR(120),
  ADD COLUMN IF NOT EXISTS replacement_actual_config JSONB,
  ADD COLUMN IF NOT EXISTS replacement_config_result JSONB,
  ADD COLUMN IF NOT EXISTS replacement_approval_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS replacement_proposed JSONB,
  ADD COLUMN IF NOT EXISTS replacement_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replacement_requested_by INTEGER,
  ADD COLUMN IF NOT EXISTS replacement_decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replacement_decided_by INTEGER,
  ADD COLUMN IF NOT EXISTS replacement_decision_note TEXT,
  ADD COLUMN IF NOT EXISTS replacement_rejections JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Vendor could not repair and keeps the laptop
  ADD COLUMN IF NOT EXISTS vendor_kept_reason TEXT,
  ADD COLUMN IF NOT EXISTS vendor_kept_mail_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vendor_kept_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vendor_kept_by INTEGER;

ALTER TABLE vendor_return_capture_tokens
  ADD COLUMN IF NOT EXISTS mode VARCHAR(20) NOT NULL DEFAULT 'repaired';
