-- ============================================================
-- Migration 206: Support revamp — work order engine
--   Prompt said 200; 200 is SLA. Next free number is 206.
-- Idempotent.
-- ============================================================

ALTER TABLE support_work_order_type_config
  ADD COLUMN IF NOT EXISTS skips_travel BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE support_work_order_type_config
   SET skips_travel = TRUE
 WHERE wo_type = 'REMOTE_FIX';

CREATE TABLE IF NOT EXISTS support_wo_idempotency (
  key         VARCHAR(80) PRIMARY KEY,
  wo_id       INT REFERENCES support_work_orders(wo_id) ON DELETE CASCADE,
  response    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE support_work_orders
  ADD COLUMN IF NOT EXISTS document_number VARCHAR(40),
  ADD COLUMN IF NOT EXISTS floor_ticket_id INT,
  ADD COLUMN IF NOT EXISTS outcome VARCHAR(20)
    CHECK (outcome IS NULL OR outcome IN ('RESOLVED','NOT_RESOLVED','PARTIAL')),
  ADD COLUMN IF NOT EXISTS suggested_next_wo_type VARCHAR(30),
  ADD COLUMN IF NOT EXISTS time_spent_minutes INT;

CREATE INDEX IF NOT EXISTS idx_wo_floor_ticket ON support_work_orders(floor_ticket_id)
  WHERE floor_ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wo_document ON support_work_orders(document_number)
  WHERE document_number IS NOT NULL;
