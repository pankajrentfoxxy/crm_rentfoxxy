-- ============================================================
-- Migration: 090_prepaid_billing.sql
-- Customer billing becomes PREPAID (vendor stays postpaid).
--
-- rent_billed_until: the last date through which this unit's rent has been
-- invoiced to the CURRENT customer. Prepaid invoices advance it to the end of
-- the billed month; a NULL means "never billed" so the next invoice catches up
-- from rent_start_date (handles a unit taken mid-month whose partial period was
-- never billed because invoices only run on the 1st). It is cleared when the
-- unit returns to stock so a re-rental to a new customer starts fresh.
-- ============================================================
ALTER TABLE vendor_serial_numbers
  ADD COLUMN IF NOT EXISTS rent_billed_until DATE;

COMMENT ON COLUMN vendor_serial_numbers.rent_billed_until IS
  'Prepaid-through date: last date the current customer has been invoiced for this rental unit. NULL = not yet billed.';
