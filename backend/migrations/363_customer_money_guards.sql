-- 363: customer money guards (claude/carret-remaining-build.md MD1-MD4, Builder 1).
--
-- Additive only. Nothing here rewrites an issued document.
--
--   MD1  payment_records.idempotency_key — a double click on "Record payment"
--        posts once. Unique per party type, NULL for every existing row.
--   MD2  credit notes carry who approved / cancelled them and why, so the
--        maker-checker rule and a cancellation leave a trail on the row itself.
--   MD3  a deposit collected as an SO payment points at that payment (one row per
--        payment), and a manually recorded deposit can carry an idempotency key.
--        Rs 0 "refunds" written as partially_refunded go back to held.
--   BL9  issued invoices with no due date (the on-delivery auto-send wrote none)
--        get the Net-15 date every other path stamps, so ageing and the overdue
--        sweep can see them.

ALTER TABLE payment_records
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(80);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payment_records_idempotency
  ON payment_records (party_type, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE customer_credit_notes
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by INTEGER,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

ALTER TABLE customer_security_deposits
  ADD COLUMN IF NOT EXISTS so_payment_id INTEGER,
  ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(80);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_security_deposits_so_payment
  ON customer_security_deposits (so_payment_id)
  WHERE so_payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_security_deposits_idempotency
  ON customer_security_deposits (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- A deposit "partially refunded" with nothing refunded is still held (MD3).
-- The old status is kept in the notes.
UPDATE customer_security_deposits
   SET status = 'held',
       notes = CONCAT_WS(E'\n', notes, 'Status was partially_refunded with Rs 0 refunded; reset to held (migration 363)'),
       updated_at = NOW()
 WHERE status = 'partially_refunded'
   AND COALESCE(refund_amount, 0) = 0;

-- Issued invoices without a due date: Net 15 from the invoice date, the term the
-- PDF has always printed and every other path stamps. Only NULLs are filled.
UPDATE customer_invoices
   SET due_date = (COALESCE(invoice_date, (sent_at AT TIME ZONE 'Asia/Kolkata')::date, created_at::date) + INTERVAL '15 days')::date,
       updated_at = NOW()
 WHERE due_date IS NULL
   AND LOWER(COALESCE(status, '')) IN ('sent', 'overdue', 'partially_paid');

CREATE INDEX IF NOT EXISTS idx_payment_records_customer_date
  ON payment_records (payment_date DESC, payment_id DESC)
  WHERE party_type = 'customer';
