-- Part 6.2 (findings BL9, BL13) — the two ends of an invoice's life that the
-- schema could not express.
--
-- BL9: nothing ever moves an invoice from 'sent' to 'overdue'. There is no job
-- and no endpoint, so the overdue bucket on the finance screen is permanently
-- zero and the outstanding figure is permanently understated. An invoice cannot
-- become overdue without a due date to be overdue against, and there was none.
--
-- BL13: 'cancelled' is filtered on in at least three places and set nowhere.
-- Every correction is therefore a direct UPDATE against the database, with no
-- reason and no trail — by design, because no other path exists.

ALTER TABLE customer_invoices
  ADD COLUMN IF NOT EXISTS due_date            DATE,
  ADD COLUMN IF NOT EXISTS overdue_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by        INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

ALTER TABLE vendor_monthly_bills
  ADD COLUMN IF NOT EXISTS due_date            DATE,
  ADD COLUMN IF NOT EXISTS cancelled_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by        INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

-- Backfill a due date for invoices that already exist, so the overdue sweep has
-- something to work from on its first run. Net 15 from the invoice date is the
-- term the PDF has always printed; it is not invented here.
UPDATE customer_invoices
   SET due_date = (COALESCE(invoice_date, created_at::date) + INTERVAL '15 days')::date
 WHERE due_date IS NULL;

UPDATE vendor_monthly_bills
   SET due_date = (COALESCE(bill_date, created_at::date) + INTERVAL '15 days')::date
 WHERE due_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_customer_invoices_overdue_sweep
  ON customer_invoices (due_date)
  WHERE status = 'sent';

CREATE INDEX IF NOT EXISTS idx_customer_invoices_status_customer
  ON customer_invoices (customer_id, status);
