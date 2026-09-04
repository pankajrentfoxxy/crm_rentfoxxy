-- Link security deposits to the invoice / laptop they were billed on.

ALTER TABLE customer_security_deposits
  ADD COLUMN IF NOT EXISTS invoice_id INT REFERENCES customer_invoices(invoice_id),
  ADD COLUMN IF NOT EXISTS serial_id INT,
  ADD COLUMN IF NOT EXISTS ttspl_id VARCHAR(60),
  ADD COLUMN IF NOT EXISTS dc_number VARCHAR(80);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_security_deposits_serial
  ON customer_security_deposits (customer_id, serial_id)
  WHERE serial_id IS NOT NULL;

ALTER TABLE customer_invoice_lines
  ADD COLUMN IF NOT EXISTS line_type VARCHAR(20) DEFAULT 'rental';
