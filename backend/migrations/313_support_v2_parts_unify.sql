-- ============================================================
-- Migration 209: Support revamp — unify part requests
--   Prompt said 203; 203 is billing hooks. Next free number is 209.
-- Extends floor part_requests. Leaves support_part_requests read-only.
-- Idempotent.
-- ============================================================

ALTER TABLE part_requests
  ADD COLUMN IF NOT EXISTS context VARCHAR(10) NOT NULL DEFAULT 'FLOOR',
  ADD COLUMN IF NOT EXISTS support_ticket_id INT,
  ADD COLUMN IF NOT EXISTS support_line_id   INT,
  ADD COLUMN IF NOT EXISTS work_order_id     INT,
  ADD COLUMN IF NOT EXISTS status_v2 VARCHAR(28),
  ADD COLUMN IF NOT EXISTS liability VARCHAR(24),
  ADD COLUMN IF NOT EXISTS charge_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS fulfilment_mode VARCHAR(24),
  ADD COLUMN IF NOT EXISTS collect_old_part BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS photo_attachment_ids JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS legacy_request_number VARCHAR(40),
  ADD COLUMN IF NOT EXISTS legacy_support_request_id INT,
  ADD COLUMN IF NOT EXISTS fulfilment_document VARCHAR(40),
  ADD COLUMN IF NOT EXISTS return_wo_id INT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'part_requests_context_check') THEN
    ALTER TABLE part_requests ADD CONSTRAINT part_requests_context_check
      CHECK (context IN ('FLOOR','FIELD'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'part_requests_liability_check') THEN
    ALTER TABLE part_requests ADD CONSTRAINT part_requests_liability_check
      CHECK (liability IS NULL OR liability IN
        ('COMPANY','CUSTOMER_CHARGEABLE','VENDOR_WARRANTY','INSURANCE','NOT_APPLICABLE'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'part_requests_fulfilment_mode_check') THEN
    ALTER TABLE part_requests ADD CONSTRAINT part_requests_fulfilment_mode_check
      CHECK (fulfilment_mode IS NULL OR fulfilment_mode IN
        ('WAREHOUSE_HANDOVER','COURIER_TO_CUSTOMER','COURIER_TO_TECH'));
  END IF;
END $$;

ALTER TABLE part_requests DROP CONSTRAINT IF EXISTS part_requests_status_v2_check;
ALTER TABLE part_requests ADD CONSTRAINT part_requests_status_v2_check
  CHECK (status_v2 IS NULL OR status_v2 IN (
    'REQUESTED','APPROVED','RESERVED','ISSUED','IN_TRANSIT','DELIVERED','CONSUMED',
    'REJECTED','CANCELLED','RETURNED_UNUSED','ESCALATED_TO_PROCUREMENT'));

CREATE INDEX IF NOT EXISTS idx_part_req_context ON part_requests(context, status_v2);
CREATE INDEX IF NOT EXISTS idx_part_req_support ON part_requests(support_ticket_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_part_req_legacy_spr
  ON part_requests(legacy_support_request_id)
  WHERE legacy_support_request_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_part_req_support_ticket') THEN
    ALTER TABLE part_requests
      ADD CONSTRAINT fk_part_req_support_ticket
      FOREIGN KEY (support_ticket_id) REFERENCES support_tickets_v2(ticket_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_part_req_support_line') THEN
    ALTER TABLE part_requests
      ADD CONSTRAINT fk_part_req_support_line
      FOREIGN KEY (support_line_id) REFERENCES support_ticket_assets(line_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_part_req_wo') THEN
    ALTER TABLE part_requests
      ADD CONSTRAINT fk_part_req_wo
      FOREIGN KEY (work_order_id) REFERENCES support_work_orders(wo_id);
  END IF;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

UPDATE part_requests SET status_v2 = CASE status
  WHEN 'pending'   THEN 'REQUESTED'  WHEN 'escalated' THEN 'ESCALATED_TO_PROCUREMENT'
  WHEN 'ordered'   THEN 'ESCALATED_TO_PROCUREMENT'
  WHEN 'received'  THEN 'RESERVED'   WHEN 'approved'  THEN 'APPROVED'
  WHEN 'attached'  THEN 'CONSUMED'   WHEN 'rejected'  THEN 'REJECTED'
  WHEN 'cancelled' THEN 'CANCELLED'  ELSE 'REQUESTED' END
WHERE status_v2 IS NULL;

INSERT INTO part_requests (
  part_name, description, status, request_number, part_id, quantity, requested_by,
  instance_id, approved_by, approved_at, rejection_reason, context, status_v2,
  support_ticket_id, legacy_request_number, legacy_support_request_id, created_at, updated_at
)
SELECT
  COALESCE(p.part_name, 'Part'),
  spr.reason,
  spr.status,
  spr.request_number,
  spr.part_id,
  spr.quantity,
  spr.requested_by,
  spr.instance_id,
  spr.approved_by,
  spr.approved_at,
  spr.rejection_reason,
  'FIELD',
  CASE spr.status
    WHEN 'pending' THEN 'REQUESTED'
    WHEN 'approved' THEN 'APPROVED'
    WHEN 'challan_generated' THEN 'RESERVED'
    WHEN 'issued' THEN 'ISSUED'
    WHEN 'dispatched' THEN 'IN_TRANSIT'
    WHEN 'delivered' THEN 'DELIVERED'
    WHEN 'used' THEN 'CONSUMED'
    WHEN 'return_requested' THEN 'ISSUED'
    WHEN 'returned' THEN 'RETURNED_UNUSED'
    WHEN 'rejected' THEN 'REJECTED'
    WHEN 'cancelled' THEN 'CANCELLED'
    ELSE 'REQUESTED' END,
  v2.ticket_id,
  spr.request_number,
  spr.id,
  spr.created_at,
  spr.updated_at
FROM support_part_requests spr
LEFT JOIN parts p ON p.part_id = spr.part_id
LEFT JOIN support_tickets_v2 v2 ON v2.legacy_ticket_id = spr.support_ticket_id
WHERE NOT EXISTS (
  SELECT 1 FROM part_requests pr WHERE pr.legacy_support_request_id = spr.id
);

CREATE TABLE IF NOT EXISTS part_compatibility (
  compat_id  SERIAL PRIMARY KEY,
  part_id    INT NOT NULL REFERENCES parts(part_id) ON DELETE CASCADE,
  brand      VARCHAR(60),
  model      VARCHAR(120),
  config_key VARCHAR(60),
  notes      TEXT,
  UNIQUE (part_id, brand, model, config_key)
);

ALTER TABLE support_ticket_assets DROP CONSTRAINT IF EXISTS support_ticket_assets_line_status_check;
ALTER TABLE support_ticket_assets ADD CONSTRAINT support_ticket_assets_line_status_check
  CHECK (line_status IN ('OPEN','IN_PROGRESS','PENDING','PENDING_PART','RESOLVED','CANCELLED'));
