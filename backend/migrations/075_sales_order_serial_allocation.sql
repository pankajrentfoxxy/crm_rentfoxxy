-- ============================================================================
-- Migration 075 — Sales-order serial allocation.
-- Warehouse attaches laptops (serials) to a Sales Order BEFORE the DC. Each
-- attachment reserves the unit and spawns one pre-dispatch QC ticket. When QC
-- passes, the DC is generated from these already-attached serials (no re-pick).
-- Additive + idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS sales_order_serials (
  allocation_id      SERIAL PRIMARY KEY,
  sales_order_number VARCHAR(50) NOT NULL,
  line_id            INT,                       -- sales_order_lines.id
  serial_id          INT REFERENCES vendor_serial_numbers(serial_id),
  ttspl_id           VARCHAR(64),
  serial_number      VARCHAR(255),
  qc_ticket_id       INT,
  qc_status          VARCHAR(20) DEFAULT 'pending'
    CHECK (qc_status IN ('pending','passed','failed')),
  status             VARCHAR(20) DEFAULT 'attached'
    CHECK (status IN ('attached','dispatched','removed')),
  dc_number          VARCHAR(50),
  entity_code        VARCHAR(20),
  created_by         INT REFERENCES users(user_id),
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- A serial can only be actively attached to one order at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sos_serial_active
  ON sales_order_serials (serial_id) WHERE status = 'attached';
CREATE INDEX IF NOT EXISTS idx_sos_so ON sales_order_serials (sales_order_number);
CREATE INDEX IF NOT EXISTS idx_sos_line ON sales_order_serials (line_id);
CREATE INDEX IF NOT EXISTS idx_sos_ticket ON sales_order_serials (qc_ticket_id);
