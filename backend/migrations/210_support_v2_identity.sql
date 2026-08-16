-- ============================================================
-- Migration 210: Support revamp — technician identity + WO slots
--   Prompt said 204; 204 is saved views. Next free number is 210.
-- Completes Phase 2 identity. Does NOT drop delivery_person_id.
-- Idempotent.
-- ============================================================

ALTER TABLE delivery_challan_lines
  ADD COLUMN IF NOT EXISTS assigned_user_id INT REFERENCES users(user_id);

UPDATE delivery_challan_lines d SET assigned_user_id = u.user_id
  FROM users u
 WHERE d.assigned_user_id IS NULL AND d.delivery_person_id = u.user_id;

UPDATE delivery_challan_lines d SET assigned_user_id = dt.user_id
  FROM delivery_technicians dt
 WHERE d.assigned_user_id IS NULL
   AND d.delivery_person_id = dt.technician_id
   AND dt.user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dcl_assigned_user ON delivery_challan_lines(assigned_user_id);

ALTER TABLE support_work_orders
  ADD COLUMN IF NOT EXISTS slot_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS slot_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS distance_km NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS priority SMALLINT;

UPDATE support_work_orders
   SET slot_start = COALESCE(slot_start, scheduled_start),
       slot_end   = COALESCE(slot_end, scheduled_end)
 WHERE slot_start IS NULL OR slot_end IS NULL;

UPDATE support_work_orders w
   SET priority = t.priority,
       sla_due_at = COALESCE(w.sla_due_at, t.sla_resolution_due_at)
  FROM support_tickets_v2 t
 WHERE t.ticket_id = w.ticket_id
   AND (w.priority IS NULL OR w.sla_due_at IS NULL);

CREATE INDEX IF NOT EXISTS idx_wo_slot ON support_work_orders(assigned_to, slot_start);
