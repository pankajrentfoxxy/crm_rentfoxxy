-- VRTDC by-hand delivery: technician reached / serial / POD (My Deliveries + bucket)
BEGIN;

ALTER TABLE vendor_return_delivery_challans
  ADD COLUMN IF NOT EXISTS reached_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tech_latitude TEXT,
  ADD COLUMN IF NOT EXISTS tech_longitude TEXT,
  ADD COLUMN IF NOT EXISTS serial_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS serial_verified_no VARCHAR(128),
  ADD COLUMN IF NOT EXISTS delivery_pod_path TEXT,
  ADD COLUMN IF NOT EXISTS delivery_pod_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS delivery_notes TEXT;

CREATE INDEX IF NOT EXISTS idx_vrtdc_delivery_person_active
  ON vendor_return_delivery_challans(delivery_person_id, status)
  WHERE delivery_person_id IS NOT NULL AND status = 'dispatched';

COMMIT;
