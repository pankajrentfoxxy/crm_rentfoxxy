-- 147_customer_type.sql
-- Classify customers as sales / rental / both for order eligibility.
-- Idempotent.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS customer_type VARCHAR(10) NOT NULL DEFAULT 'both';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_customers_customer_type'
  ) THEN
    ALTER TABLE customers
      ADD CONSTRAINT chk_customers_customer_type
      CHECK (customer_type IN ('sales', 'rental', 'both'));
  END IF;
END $$;

UPDATE customers SET customer_type = 'both' WHERE customer_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_customers_customer_type
  ON customers (customer_type)
  WHERE status = 1;
