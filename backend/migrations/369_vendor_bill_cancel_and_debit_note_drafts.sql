-- Vendor money (MD5, MD6) — 29 Sep 2026.
--
-- 1. Cancel on a vendor bill always failed: the status CHECK (last written by
--    118_payments_ledger.sql) has no 'cancelled', so the UPDATE in
--    invoiceLifecycleService.cancelVendorBill was rejected by the database.
--    The check is rebuilt with the same five values plus 'cancelled'.
--
-- 2. A cancelled bill must not block the month from being billed again (the
--    usual reason to cancel is a wrong rate or a wrong rent start). The
--    UNIQUE (vendor_id, bill_month, bill_year) constraint becomes a partial
--    unique index over the bills that are not cancelled. Nothing is deleted;
--    uniqueness among live bills is unchanged.
--
-- 3. Debit-note drafts (vendor return / repair / floor QC fail) are created at
--    Rs 0 with "set the amount and approve", but there was no way to cancel
--    one. Who cancelled it, when and why is recorded; plus who last set the
--    amount. amount may not go negative.
--
-- Idempotent: every step checks before it changes anything. Not replayed on
-- boot. 053 (replayed) only does CREATE TABLE IF NOT EXISTS for these tables,
-- so it does not undo any of this.

-- 1. Status check with 'cancelled'.
DO $$
DECLARE
  r RECORD;
  has_cancelled BOOLEAN;
BEGIN
  SELECT bool_or(pg_get_constraintdef(con.oid) LIKE '%cancelled%')
    INTO has_cancelled
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
   WHERE rel.relname = 'vendor_monthly_bills'
     AND con.contype = 'c'
     AND pg_get_constraintdef(con.oid) LIKE '%status%';

  IF COALESCE(has_cancelled, FALSE) THEN
    RETURN;
  END IF;

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

  ALTER TABLE vendor_monthly_bills
    ADD CONSTRAINT vendor_monthly_bills_status_check
    CHECK (status IN ('generated','approved','paid','partially_paid','disputed','cancelled'));
END $$;

-- 2. One live bill per vendor and month; cancelled bills stay as history.
CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_monthly_bills_live_month
  ON vendor_monthly_bills (vendor_id, bill_month, bill_year)
  WHERE status <> 'cancelled';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'vendor_monthly_bills_vendor_id_bill_month_bill_year_key'
       AND conrelid = 'vendor_monthly_bills'::regclass
  ) THEN
    ALTER TABLE vendor_monthly_bills
      DROP CONSTRAINT vendor_monthly_bills_vendor_id_bill_month_bill_year_key;
  END IF;
END $$;

-- 3. Debit notes: cancel trail, who set the amount, no negative amounts.
ALTER TABLE vendor_debit_notes
  ADD COLUMN IF NOT EXISTS cancelled_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by        INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
  ADD COLUMN IF NOT EXISTS amount_set_by       INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS amount_set_at       TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'vendor_debit_notes_amount_not_negative'
       AND conrelid = 'vendor_debit_notes'::regclass
  ) THEN
    ALTER TABLE vendor_debit_notes
      ADD CONSTRAINT vendor_debit_notes_amount_not_negative CHECK (COALESCE(amount, 0) >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_vendor_debit_notes_adjusted_bill
  ON vendor_debit_notes (adjusted_in_bill_id) WHERE adjusted_in_bill_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vendor_debit_notes_vendor_status
  ON vendor_debit_notes (vendor_id, status);
