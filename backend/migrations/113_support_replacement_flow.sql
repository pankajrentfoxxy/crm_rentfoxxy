-- ============================================================
-- Migration 113: Support replacement flow (SO + outbound DC + Return DC)
-- Idempotent: safe to re-run.
-- ============================================================

BEGIN;

ALTER TABLE delivery_challan_lines
  ADD COLUMN IF NOT EXISTS dc_purpose VARCHAR(40) DEFAULT 'standard';

ALTER TABLE delivery_challan_lines
  ADD COLUMN IF NOT EXISTS support_replacement_order_id INT;

CREATE INDEX IF NOT EXISTS idx_dcl_replacement_order
  ON delivery_challan_lines (support_replacement_order_id)
  WHERE support_replacement_order_id IS NOT NULL;

ALTER TABLE support_replacement_orders
  ADD COLUMN IF NOT EXISTS new_serial_id INT,
  ADD COLUMN IF NOT EXISTS old_serial_id INT,
  ADD COLUMN IF NOT EXISTS old_rent_monthly_rate NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS return_dc_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS delivery_address JSONB,
  ADD COLUMN IF NOT EXISTS contact_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(80),
  ADD COLUMN IF NOT EXISTS delivery_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS outbound_dispatch_mode VARCHAR(20),
  ADD COLUMN IF NOT EXISTS outbound_delivery_person_id INT;

UPDATE delivery_challan_lines
   SET dc_purpose = 'standard'
 WHERE dc_purpose IS NULL;

COMMIT;
