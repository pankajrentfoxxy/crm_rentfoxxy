-- Payment ledger + partial payment support (customer invoices + vendor bills).
BEGIN;

CREATE TABLE IF NOT EXISTS payment_records (
  payment_id        SERIAL PRIMARY KEY,
  party_type        VARCHAR(10) NOT NULL CHECK (party_type IN ('customer','vendor')),
  customer_id       INT REFERENCES customers(customer_id),
  vendor_id         INT REFERENCES vendors(vendor_id),
  invoice_id        INT REFERENCES customer_invoices(invoice_id),
  bill_id           INT REFERENCES vendor_monthly_bills(bill_id),
  amount            NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  payment_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  method            VARCHAR(40),
  reference         VARCHAR(120),
  notes             TEXT,
  recorded_by       INT REFERENCES users(user_id),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_records_invoice
  ON payment_records(invoice_id) WHERE invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_records_bill
  ON payment_records(bill_id) WHERE bill_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_records_customer
  ON payment_records(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_records_vendor
  ON payment_records(vendor_id) WHERE vendor_id IS NOT NULL;

ALTER TABLE customer_invoices
  ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12,2) DEFAULT 0;

ALTER TABLE vendor_monthly_bills
  ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12,2) DEFAULT 0;

-- Existing paid invoices/bills predate the ledger table, so seed their
-- balance snapshot to avoid allowing a second full payment after deploy.
UPDATE customer_invoices
SET amount_paid = COALESCE(grand_total, 0)
WHERE status = 'paid'
  AND COALESCE(amount_paid, 0) = 0;

UPDATE vendor_monthly_bills
SET amount_paid = COALESCE(total_payable, 0)
WHERE status = 'paid'
  AND COALESCE(amount_paid, 0) = 0;

-- Extend status CHECK to include partially_paid (drop named constraint if present).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'customer_invoices'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE customer_invoices DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE customer_invoices
  ADD CONSTRAINT customer_invoices_status_check
  CHECK (status IN ('draft','sent','paid','partially_paid','overdue','cancelled'));

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'vendor_monthly_bills'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) LIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE vendor_monthly_bills DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE vendor_monthly_bills
  ADD CONSTRAINT vendor_monthly_bills_status_check
  CHECK (status IN ('generated','approved','paid','partially_paid','disputed'));

COMMIT;
