-- Migration: 235_physical_part_outward_dispatch.sql
-- Warehouse dispatch lifecycle for physical-part outwards:
-- draft → dispatch_ready (e-sign + PDF + gate QR) → dispatched (guard confirm).

ALTER TABLE physical_part_outwards
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS ship_by VARCHAR(20),
  ADD COLUMN IF NOT EXISTS dispatch_mode VARCHAR(20),
  ADD COLUMN IF NOT EXISTS courier_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS awb_number VARCHAR(128),
  ADD COLUMN IF NOT EXISTS courier_tracking_url TEXT,
  ADD COLUMN IF NOT EXISTS porter_tracking_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS porter_order_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS porter_booking_url TEXT,
  ADD COLUMN IF NOT EXISTS delivery_person_id INT,
  ADD COLUMN IF NOT EXISTS warehouse_dispatch_esign_url TEXT,
  ADD COLUMN IF NOT EXISTS warehouse_dispatch_signer_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS recipient_esign_url TEXT,
  ADD COLUMN IF NOT EXISTS recipient_signer_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gate_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pdf_path TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE physical_part_outwards DROP CONSTRAINT IF EXISTS physical_part_outwards_status_chk;
ALTER TABLE physical_part_outwards
  ADD CONSTRAINT physical_part_outwards_status_chk
  CHECK (status IN ('draft', 'dispatch_ready', 'dispatched', 'cancelled'));

ALTER TABLE physical_dead_parts DROP CONSTRAINT IF EXISTS physical_dead_parts_status_chk;
ALTER TABLE physical_dead_parts
  ADD CONSTRAINT physical_dead_parts_status_chk
  CHECK (status IN ('available', 'pending', 'out'));

-- Pre-dispatch-flow outwards already handed parts out — treat as dispatched.
UPDATE physical_part_outwards o
   SET status = 'dispatched',
       dispatched_at = COALESCE(o.dispatched_at, o.created_at),
       updated_at = NOW()
 WHERE o.status = 'draft'
   AND EXISTS (
     SELECT 1 FROM physical_dead_parts p
      WHERE p.outward_id = o.outward_id
        AND p.status = 'out'
   );

CREATE INDEX IF NOT EXISTS idx_physical_part_outwards_status
  ON physical_part_outwards (status);
