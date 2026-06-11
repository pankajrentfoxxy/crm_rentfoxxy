ALTER TABLE sales_quotations
  ADD COLUMN IF NOT EXISTS source_lead_id INT REFERENCES leads(lead_id);

CREATE INDEX IF NOT EXISTS idx_sales_quotations_lead
  ON sales_quotations (source_lead_id)
  WHERE source_lead_id IS NOT NULL;
