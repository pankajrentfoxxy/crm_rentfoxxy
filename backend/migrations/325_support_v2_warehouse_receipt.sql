-- ============================================================
-- Migration 221: Signed warehouse receipt (D13).
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS support_warehouse_receipts (
  receipt_id        SERIAL PRIMARY KEY,
  receipt_number    VARCHAR(30) NOT NULL UNIQUE,
  wo_id             INT NOT NULL REFERENCES support_work_orders(wo_id) ON DELETE CASCADE,
  ticket_id         INT REFERENCES support_tickets_v2(ticket_id) ON DELETE SET NULL,
  dc_number         VARCHAR(40),
  received_by       INT REFERENCES users(user_id),
  received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  handover_by_user  INT REFERENCES users(user_id),
  handover_courier  VARCHAR(40),
  signature_attachment_id INT,
  signer_name       VARCHAR(120),
  signer_role       VARCHAR(40),
  status            VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT','SIGNED','DISPUTED','CANCELLED')),
  short_shipment_reason TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wh_receipt_wo ON support_warehouse_receipts(wo_id);

CREATE TABLE IF NOT EXISTS support_warehouse_receipt_lines (
  receipt_line_id   SERIAL PRIMARY KEY,
  receipt_id        INT NOT NULL REFERENCES support_warehouse_receipts(receipt_id) ON DELETE CASCADE,
  line_id           INT REFERENCES support_ticket_assets(line_id) ON DELETE SET NULL,
  serial_id         INT,
  ttspl_id          VARCHAR(40),
  serial_number     VARCHAR(120),
  scanned_value     VARCHAR(120),
  received          BOOLEAN NOT NULL DEFAULT FALSE,
  condition_matches_pickup BOOLEAN,
  new_damage_found  BOOLEAN NOT NULL DEFAULT FALSE,
  new_damage_note   TEXT,
  photo_attachment_ids JSONB NOT NULL DEFAULT '[]',
  accessories_expected JSONB NOT NULL DEFAULT '[]',
  accessories_received JSONB NOT NULL DEFAULT '[]',
  floor_ticket_id   INT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wh_receipt_line
  ON support_warehouse_receipt_lines (receipt_id, (COALESCE(line_id, 0)), (COALESCE(serial_id, 0)));
CREATE INDEX IF NOT EXISTS idx_wh_receipt_lines_serial ON support_warehouse_receipt_lines(serial_id);

CREATE SEQUENCE IF NOT EXISTS support_wh_receipt_seq START 1;
