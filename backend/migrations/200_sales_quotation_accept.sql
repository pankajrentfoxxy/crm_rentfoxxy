-- Customer accept on sales quotations + walk-in contact fields (GST optional).

ALTER TABLE sales_quotations
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS quotation_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS company_name VARCHAR(255);

ALTER TABLE sales_quotations DROP CONSTRAINT IF EXISTS sales_quotations_status_check;

ALTER TABLE sales_quotations
  ADD CONSTRAINT sales_quotations_status_check
  CHECK (status IN ('pending', 'sent', 'accepted', 'approved', 'rejected'));

CREATE INDEX IF NOT EXISTS idx_sales_quotations_token
  ON sales_quotations (token)
  WHERE token IS NOT NULL;
