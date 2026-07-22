-- ============================================================
-- Migration 097: Support module Phase 18 enhancements
--   - Geolocation capture on technician visit
--   - TTSPL verification gate before "reached"
--   - Pickup -> warehouse -> floor-ticket tracking
--   - "Proof of Completion" path (alias of pod_image_path)
--   - Replacement orders linked to sales (SO/DC) flow
--   - Permission section for the support technician bucket
-- Idempotent: safe to re-run.
-- ============================================================

-- 1. support_ticket_items: visit geo + TTSPL verify + warehouse return
ALTER TABLE support_ticket_items
  ADD COLUMN IF NOT EXISTS visited_lat              VARCHAR(30),
  ADD COLUMN IF NOT EXISTS visited_lng              VARCHAR(30),
  ADD COLUMN IF NOT EXISTS ttspl_id                 VARCHAR(120),
  ADD COLUMN IF NOT EXISTS ttspl_verified           BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ttspl_verified_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ttspl_verified_by        INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS reached_warehouse_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS warehouse_received_by    INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS floor_ticket_id          INT REFERENCES tickets(ticket_id),
  ADD COLUMN IF NOT EXISTS proof_of_completion_path TEXT;

-- Backfill the new alias column from the legacy POD path
UPDATE support_ticket_items
SET proof_of_completion_path = pod_image_path
WHERE pod_image_path IS NOT NULL
  AND proof_of_completion_path IS NULL;

-- Backfill per-item TTSPL id from the unique serial / asset code
UPDATE support_ticket_items
SET ttspl_id = unique_serial_number
WHERE ttspl_id IS NULL
  AND unique_serial_number IS NOT NULL;

-- 2. support_replacement_orders: link to the sales / DC flow
ALTER TABLE support_replacement_orders
  ADD COLUMN IF NOT EXISTS sales_order_number  VARCHAR(50),
  ADD COLUMN IF NOT EXISTS dc_number           VARCHAR(50),
  ADD COLUMN IF NOT EXISTS pickup_item_id      INT REFERENCES support_ticket_items(id),
  ADD COLUMN IF NOT EXISTS delivery_person_id  INT,
  ADD COLUMN IF NOT EXISTS pickup_assigned_to  INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS pickup_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pickup_pod_path     TEXT,
  ADD COLUMN IF NOT EXISTS new_dc_number       VARCHAR(50);

-- 3. Permission section for the support technician (field) bucket
INSERT INTO permission_sections (section, description, sort_order)
VALUES ('support_technician', 'Support Technician (field view)', 320)
ON CONFLICT (section) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('support_tech', 'support_technician', true, false, true, false),
  ('support_lead', 'support_technician', true, true, true, true),
  ('admin',        'support_technician', true, true, true, true),
  ('manager',      'support_technician', true, false, true, false)
ON CONFLICT (role, section) DO NOTHING;
