-- Part 4.1 (finding S1) — constrain sales_order_lines.quotation_type.
--
-- THIS LANDS BEFORE ANYTHING ELSE IN PART 4, because the two-entity split
-- Decision 1 makes structural cannot be trusted on screen until it does.
--
-- The defect: `sales_quotations.quotation_type` has a CHECK constraining it to
-- sale / rental / demo. `sales_order_lines.quotation_type` has none — and
-- entityForQuotationType() maps every unknown value silently to 'rentfoxxy'
-- through a bare `return` at the end of its if-chain.
--
-- So today a typo in the order type picks which brand bills the customer.
-- 'Sale', 'SALE ', 'rentaal' — every one of them quietly becomes a RentFoxxy
-- order. There is no error, no warning, and the first sign is an invoice from
-- the wrong entity with the wrong GSTIN on it.
--
-- Verified before applying: sales_order_lines holds rental (4,812), sale (370)
-- and demo (118) and nothing else, so this constrains existing data without a
-- mapping migration. The window in which that was true is exactly why it is
-- worth closing now.
--
-- The runtime half is in services/salesManagementService.js:
-- entityForQuotationType now throws on an unknown value instead of defaulting.
-- A constraint alone would catch the write but not the read, and the read is
-- what picks the billing entity.

ALTER TABLE public.sales_order_lines
  DROP CONSTRAINT IF EXISTS sales_order_lines_quotation_type_check;

ALTER TABLE public.sales_order_lines
  ADD CONSTRAINT sales_order_lines_quotation_type_check
  CHECK (
    quotation_type IS NULL
    OR quotation_type IN ('sale', 'rental', 'demo')
  );

COMMENT ON CONSTRAINT sales_order_lines_quotation_type_check
  ON public.sales_order_lines IS
  'Part 4.1 / S1. Matches the constraint sales_quotations has carried since 044. '
  'NULL is permitted because older ERP-imported lines predate the column; '
  'entityForQuotationType treats NULL as rental explicitly rather than by '
  'falling through, and throws on anything it does not recognise.';
