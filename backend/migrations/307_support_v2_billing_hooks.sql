-- ============================================================
-- Migration 203: Support revamp — billing hook tables.
--   Number is 203 (not 198) because 196–200 already exist.
-- Tables only. Do not wire billing cron (Phase 11).
-- Idempotent. Columns reconstructed from Phases 04–11 usage.
-- ============================================================

CREATE TABLE IF NOT EXISTS asset_billing_holds (
  hold_id       SERIAL PRIMARY KEY,
  ticket_id     INT REFERENCES support_tickets_v2(ticket_id) ON DELETE SET NULL,
  line_id       INT REFERENCES support_ticket_assets(line_id) ON DELETE SET NULL,
  wo_id         INT REFERENCES support_work_orders(wo_id) ON DELETE SET NULL,
  serial_id     INT,
  customer_id   INT REFERENCES customers(customer_id),
  hold_from     DATE NOT NULL DEFAULT CURRENT_DATE,
  hold_to       DATE,
  waive_rent    BOOLEAN NOT NULL DEFAULT FALSE,
  reason        VARCHAR(80),
  demo_seed     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_asset_holds_serial ON asset_billing_holds(serial_id);
CREATE INDEX IF NOT EXISTS idx_asset_holds_customer ON asset_billing_holds(customer_id);
CREATE INDEX IF NOT EXISTS idx_asset_holds_open ON asset_billing_holds(serial_id) WHERE hold_to IS NULL;

CREATE TABLE IF NOT EXISTS customer_invoice_extra_lines (
  extra_line_id         SERIAL PRIMARY KEY,
  ticket_id             INT REFERENCES support_tickets_v2(ticket_id) ON DELETE SET NULL,
  line_id               INT REFERENCES support_ticket_assets(line_id) ON DELETE SET NULL,
  customer_id           INT REFERENCES customers(customer_id),
  charge_type           VARCHAR(40) NOT NULL,
  description           TEXT,
  amount                NUMERIC(12,2) NOT NULL DEFAULT 0,
  status                VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('PENDING','APPROVED','REJECTED','WAIVED','BILLED')),
  billed_in_invoice_id  INT,
  evidence_urls         JSONB NOT NULL DEFAULT '[]',
  photo_attachment_ids  JSONB NOT NULL DEFAULT '[]',
  waived_reason         TEXT,
  demo_seed             BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_extra_lines_customer ON customer_invoice_extra_lines(customer_id);
CREATE INDEX IF NOT EXISTS idx_extra_lines_status ON customer_invoice_extra_lines(status);

CREATE TABLE IF NOT EXISTS customer_buffer_stock (
  buffer_id     SERIAL PRIMARY KEY,
  customer_id   INT NOT NULL REFERENCES customers(customer_id),
  site_id       INT,
  serial_id     INT,
  ttspl_id      VARCHAR(40),
  status        VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE'
                  CHECK (status IN ('AVAILABLE','DEPLOYED','RETURNED')),
  demo_seed     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_buffer_stock_customer ON customer_buffer_stock(customer_id, status);

CREATE TABLE IF NOT EXISTS vendor_warranty_claims (
  claim_id      SERIAL PRIMARY KEY,
  ticket_id     INT REFERENCES support_tickets_v2(ticket_id) ON DELETE SET NULL,
  line_id       INT REFERENCES support_ticket_assets(line_id) ON DELETE SET NULL,
  serial_id     INT,
  vendor_id     INT,
  status        VARCHAR(20) NOT NULL DEFAULT 'OPEN'
                  CHECK (status IN ('OPEN','SUBMITTED','APPROVED','REJECTED','CLOSED')),
  claim_ref     VARCHAR(80),
  amount        NUMERIC(12,2),
  notes         TEXT,
  demo_seed     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vendor_claims_ticket ON vendor_warranty_claims(ticket_id);
