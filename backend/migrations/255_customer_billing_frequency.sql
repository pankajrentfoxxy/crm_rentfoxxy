-- Quarterly and half-yearly billing.
--
-- customers.billing_type answers WHEN the money is collected (prepaid = up
-- front, postpaid = in arrears) and its CHECK allows only those two values.
-- Frequency is a second, independent question — HOW LONG one invoice covers —
-- so overloading billing_type with 'quarterly' would have collapsed the two and
-- broken getCustomerBillingType(), which treats anything that is not 'postpaid'
-- as prepaid. A customer can be quarterly prepaid or quarterly postpaid.
--
-- Hence a separate column. Every existing customer keeps monthly billing, so
-- this is a no-op until someone changes a row.
--
--   monthly      - one calendar month per invoice (today's behaviour)
--   quarterly    - three months
--   half_yearly  - six months
--
-- Cycles are anchored per asset, to rent_billed_until + 1 (or the rental start
-- when nothing has been billed yet). A laptop whose period opens 12 Nov bills
-- 12 Nov - 11 Feb, then 12 Feb - 11 May. Moving a customer onto a longer cycle
-- mid-life therefore transitions cleanly from wherever each asset's billing
-- currently stands, without re-opening a period that was already invoiced.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS billing_frequency VARCHAR(20) NOT NULL DEFAULT 'monthly';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_customers_billing_frequency'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT chk_customers_billing_frequency
      CHECK (billing_frequency IN ('monthly', 'quarterly', 'half_yearly'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customers_billing_frequency
  ON public.customers (billing_frequency)
  WHERE billing_frequency <> 'monthly';

COMMENT ON COLUMN public.customers.billing_frequency IS
  'How many months one invoice covers: monthly | quarterly | half_yearly. '
  'Independent of billing_type (prepaid/postpaid). Cycles are anchored per '
  'asset to rent_billed_until + 1.';
