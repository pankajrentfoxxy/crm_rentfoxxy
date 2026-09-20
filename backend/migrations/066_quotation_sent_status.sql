ALTER TABLE sales_quotations DROP CONSTRAINT IF EXISTS sales_quotations_status_check;

-- 'accepted' arrived in 200. This file is replayed on every boot by
-- ensureSalesManagementSchema, so a narrower list here aborts the replay against
-- a live accepted quotation and 200 never gets the chance to widen it back.
ALTER TABLE sales_quotations
  ADD CONSTRAINT sales_quotations_status_check
  CHECK (status IN ('pending', 'sent', 'accepted', 'approved', 'rejected'));
