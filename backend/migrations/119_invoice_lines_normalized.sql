-- Normalized invoice/bill line mirrors for SQL reporting (JSONB snapshots retained).
BEGIN;

CREATE TABLE IF NOT EXISTS customer_invoice_lines (
  line_id          SERIAL PRIMARY KEY,
  invoice_id       INT NOT NULL REFERENCES customer_invoices(invoice_id) ON DELETE CASCADE,
  serial_id        INT,
  ttspl_id         VARCHAR(60),
  brand            VARCHAR(80),
  model            VARCHAR(120),
  period_label     VARCHAR(10),
  rent_start       DATE,
  rent_end         DATE,
  days_billed      INT,
  days_in_month    INT,
  monthly_rate     NUMERIC(12,2),
  daily_rate       NUMERIC(12,2),
  amount           NUMERIC(12,2),
  is_catchup       BOOLEAN DEFAULT FALSE,
  is_returned      BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cil_invoice ON customer_invoice_lines(invoice_id);
CREATE INDEX IF NOT EXISTS idx_cil_serial  ON customer_invoice_lines(serial_id);
CREATE INDEX IF NOT EXISTS idx_cil_brand   ON customer_invoice_lines(brand);

CREATE TABLE IF NOT EXISTS vendor_bill_lines (
  line_id          SERIAL PRIMARY KEY,
  bill_id          INT NOT NULL REFERENCES vendor_monthly_bills(bill_id) ON DELETE CASCADE,
  serial_id        INT,
  ttspl_id         VARCHAR(60),
  days_in_month    INT,
  monthly_rate     NUMERIC(12,2),
  daily_rate       NUMERIC(12,2),
  amount           NUMERIC(12,2),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vbl_bill   ON vendor_bill_lines(bill_id);
CREATE INDEX IF NOT EXISTS idx_vbl_serial ON vendor_bill_lines(serial_id);

COMMIT;
