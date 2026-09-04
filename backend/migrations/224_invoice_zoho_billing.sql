-- First-order invoices sent from Zoho must not be re-billed as catch-up
-- or security on the next CRM monthly invoice.

ALTER TABLE customer_invoices
  ADD COLUMN IF NOT EXISTS billing_source VARCHAR(20) NOT NULL DEFAULT 'crm';

ALTER TABLE customer_invoices
  ADD COLUMN IF NOT EXISTS external_reference VARCHAR(100);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_customer_invoices_billing_source'
  ) THEN
    ALTER TABLE customer_invoices
      ADD CONSTRAINT chk_customer_invoices_billing_source
      CHECK (billing_source IN ('crm', 'zoho'));
  END IF;
END $$;

COMMENT ON COLUMN customer_invoices.billing_source IS
  'crm = generated here; zoho = first-order invoice already sent from Zoho.';
COMMENT ON COLUMN customer_invoices.external_reference IS
  'Zoho invoice number or other external reference.';

CREATE TABLE IF NOT EXISTS customer_serial_billing_ack (
  ack_id SERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(customer_id),
  serial_id INT NOT NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'zoho',
  external_invoice_ref VARCHAR(100),
  rent_billed_through DATE NOT NULL,
  security_billed BOOLEAN NOT NULL DEFAULT FALSE,
  security_amount NUMERIC(12,2),
  invoice_id INT REFERENCES customer_invoices(invoice_id),
  created_by INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (customer_id, serial_id)
);

CREATE INDEX IF NOT EXISTS idx_serial_billing_ack_invoice
  ON customer_serial_billing_ack (invoice_id);

COMMENT ON TABLE customer_serial_billing_ack IS
  'Per-laptop first-order billing already taken outside CRM (typically Zoho). Catch-up and security stay off later monthly invoices.';
