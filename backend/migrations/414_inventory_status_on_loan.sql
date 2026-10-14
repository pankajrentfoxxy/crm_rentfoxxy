-- 414: 'on_loan' joins the canonical inventory statuses.
--
-- Production's loan laptop workflow (262_loan_laptop_workflow.sql, merged
-- 14 Oct 2026) adds a fourteenth state, 'on_loan': a free laptop with a rental
-- customer while their own is away for repair (services/loanLaptopService,
-- inventoryStateMachine.markLoanDelivered). Production has no status CHECK, so
-- its migration does not touch one; on this branch the CHECK from 259 / 335
-- would refuse every Loan DC delivery without this.
--
-- Constraint only: no rows are rewritten. Safe before or after 262.
ALTER TABLE public.vendor_serial_numbers
  DROP CONSTRAINT IF EXISTS vendor_serial_numbers_inventory_status_check;
ALTER TABLE public.vendor_serial_numbers
  ADD CONSTRAINT vendor_serial_numbers_inventory_status_check
  CHECK (
    deleted_at IS NOT NULL
    OR inventory_status IS NULL
    OR inventory_status IN (
      'in_stock', 'reserved', 'dispatch_ready', 'at_gate', 'in_transit', 'rented', 'on_demo',
      'on_loan', 'sold', 'returned', 'in_repair', 'qc_failed', 'scrapped', 'returned_to_vendor'
    )
  );
