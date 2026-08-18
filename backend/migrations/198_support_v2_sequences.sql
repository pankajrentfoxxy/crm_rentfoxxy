-- ============================================================
-- Migration 198: Support revamp — document sequences
--   STK- for v2 tickets, WO- for work orders. Existing GST prefixes
--   (EST- SO- DC- …) are not touched.
-- Idempotent: safe to re-run.
-- ============================================================

INSERT INTO sm_document_sequences (doc_type, last_value, prefix) VALUES
  ('support_ticket_v2',  0, 'STK-'),
  ('support_work_order', 0, 'WO-')
ON CONFLICT (doc_type) DO NOTHING;
