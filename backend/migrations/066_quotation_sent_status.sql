ALTER TABLE sales_quotations DROP CONSTRAINT IF EXISTS sales_quotations_status_check;

ALTER TABLE sales_quotations
  ADD CONSTRAINT sales_quotations_status_check
  CHECK (status IN ('pending', 'sent', 'approved', 'rejected'));
