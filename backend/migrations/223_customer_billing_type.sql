-- Prepaid (default): invoice the current month on the 1st.
-- Postpaid: invoice the previous calendar month on the 1st.
-- Mid-month returns on postpaid bill 1st-of-month through warehouse received date.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS billing_type VARCHAR(20) NOT NULL DEFAULT 'prepaid';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_customers_billing_type'
  ) THEN
    ALTER TABLE customers
      ADD CONSTRAINT chk_customers_billing_type
      CHECK (billing_type IN ('prepaid', 'postpaid'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customers_billing_type
  ON customers (billing_type);

COMMENT ON COLUMN customers.billing_type IS
  'prepaid = bill current month on the 1st; postpaid = bill previous month on the 1st, capped at warehouse received date.';
