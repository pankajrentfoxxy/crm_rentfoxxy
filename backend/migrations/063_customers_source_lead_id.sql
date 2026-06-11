-- Link customers back to originating lead (Deal/Demo auto-conversion)

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS source_lead_id INT REFERENCES leads(lead_id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customers_source_lead_id_key
  ON customers (source_lead_id)
  WHERE source_lead_id IS NOT NULL;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS customer_id INT REFERENCES customers(customer_id);
