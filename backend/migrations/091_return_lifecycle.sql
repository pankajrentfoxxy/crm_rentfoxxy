-- ============================================================
-- Migration: 091_return_lifecycle.sql
-- Links credit/debit notes to the returned unit + its return QC ticket so the
-- return lifecycle is fully traceable (CN/DN -> TTSPL -> floor ticket -> history).
-- ticket_type is a free varchar (no CHECK), so 'return_qc' needs no constraint change.
-- ============================================================
ALTER TABLE customer_credit_notes
  ADD COLUMN IF NOT EXISTS serial_id        INT,
  ADD COLUMN IF NOT EXISTS return_ticket_id INT,
  ADD COLUMN IF NOT EXISTS source           VARCHAR(30);

ALTER TABLE vendor_debit_notes
  ADD COLUMN IF NOT EXISTS serial_id         INT,
  ADD COLUMN IF NOT EXISTS return_ticket_id  INT,
  ADD COLUMN IF NOT EXISTS support_ticket_id INT;

-- Allow the new 'return_qc' ticket type (returned units re-enter the floor).
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_ticket_type_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_ticket_type_check
  CHECK (ticket_type IN ('grn_qc', 'sales_order_qc', 'return_qc', 'support', 'general'));

-- Ensure the vendor-return status is allowed (migration 085 was not applied on
-- this DB; without it markQcFailed/Force-Fail crashes on tickets_status_check).
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_status_check
  CHECK (status IN ('in_progress', 'completed', 'failed', 'on_hold', 'qc_failed_return_vendor'));

CREATE INDEX IF NOT EXISTS idx_credit_notes_return_ticket ON customer_credit_notes(return_ticket_id);
CREATE INDEX IF NOT EXISTS idx_debit_notes_return_ticket  ON vendor_debit_notes(return_ticket_id);

COMMENT ON COLUMN customer_credit_notes.return_ticket_id IS 'Floor return_qc ticket raised when the unit was picked up';
COMMENT ON COLUMN vendor_debit_notes.return_ticket_id IS 'Floor ticket whose Force-Fail returned the unit to the vendor';
