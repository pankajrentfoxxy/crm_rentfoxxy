-- 327: store the quotation header fields the form has always asked for.
--
-- The quotation drawer collected a validity date, terms & conditions and header
-- remarks, and the server threw all three away (there were no columns). A
-- quotation is one row per line with the header repeated, so these are
-- repeated on every line like every other header field.
--
-- Additive only: three nullable columns, no backfill, no data rewritten.
ALTER TABLE sales_quotations
  ADD COLUMN IF NOT EXISTS validity_date DATE,
  ADD COLUMN IF NOT EXISTS terms TEXT,
  ADD COLUMN IF NOT EXISTS quotation_remarks TEXT;

COMMENT ON COLUMN sales_quotations.validity_date IS 'Quote valid until (header field, repeated per line)';
COMMENT ON COLUMN sales_quotations.terms IS 'Terms & conditions printed on the quotation';
COMMENT ON COLUMN sales_quotations.quotation_remarks IS 'Header remarks; per-line notes stay in remark';
