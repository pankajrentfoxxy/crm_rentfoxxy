-- ============================================================
-- Migration 215: Support v2 work-order logistics — validated
--   method, courier payload, multi-slot booking (D4).
-- Idempotent.
-- ============================================================

ALTER TABLE support_work_orders
  ADD COLUMN IF NOT EXISTS courier_partner VARCHAR(40),
  ADD COLUMN IF NOT EXISTS courier_other_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS courier_direction VARCHAR(20),
  ADD COLUMN IF NOT EXISTS courier_awb VARCHAR(60),
  ADD COLUMN IF NOT EXISTS courier_pickup_date DATE,
  ADD COLUMN IF NOT EXISTS courier_declared_value NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS courier_packaging_note TEXT,
  ADD COLUMN IF NOT EXISTS remote_contact_window VARCHAR(40),
  ADD COLUMN IF NOT EXISTS batch_group_id VARCHAR(40);

UPDATE support_work_orders
   SET method = UPPER(method)
 WHERE method IS NOT NULL AND method <> UPPER(method);

UPDATE support_work_orders
   SET method = NULL
 WHERE method IS NOT NULL
   AND method NOT IN ('TECHNICIAN', 'COURIER', 'REMOTE');

ALTER TABLE support_work_orders DROP CONSTRAINT IF EXISTS support_work_orders_method_check;
ALTER TABLE support_work_orders ADD CONSTRAINT support_work_orders_method_check
  CHECK (method IS NULL OR method IN ('TECHNICIAN', 'COURIER', 'REMOTE'));

CREATE TABLE IF NOT EXISTS support_wo_slots (
  slot_id     SERIAL PRIMARY KEY,
  wo_id       INT NOT NULL REFERENCES support_work_orders(wo_id) ON DELETE CASCADE,
  slot_date   DATE NOT NULL,
  slot_start  TIME NOT NULL,
  slot_end    TIME NOT NULL,
  user_id     INT REFERENCES users(user_id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (wo_id, slot_date, slot_start)
);

CREATE INDEX IF NOT EXISTS idx_wo_slots_user_date ON support_wo_slots(user_id, slot_date);
CREATE INDEX IF NOT EXISTS idx_wo_slots_wo ON support_wo_slots(wo_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wo_slots_user_start
  ON support_wo_slots(user_id, slot_date, slot_start)
  WHERE user_id IS NOT NULL;

INSERT INTO support_wo_slots (wo_id, slot_date, slot_start, slot_end, user_id)
SELECT wo_id,
       (scheduled_start AT TIME ZONE 'Asia/Kolkata')::date,
       (scheduled_start AT TIME ZONE 'Asia/Kolkata')::time,
       (COALESCE(scheduled_end, scheduled_start + INTERVAL '1 hour') AT TIME ZONE 'Asia/Kolkata')::time,
       assigned_to
  FROM support_work_orders
 WHERE scheduled_start IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE user_shifts ALTER COLUMN end_time SET DEFAULT TIME '19:00';
UPDATE user_shifts SET end_time = TIME '19:00' WHERE end_time = TIME '18:30';
