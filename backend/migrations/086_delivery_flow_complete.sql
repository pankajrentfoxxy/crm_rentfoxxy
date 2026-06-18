-- ============================================================
-- Migration 086: Complete delivery flow
-- - Per-serial delivery addresses on SO
-- - DC per-serial tracking (one DC = one or more serials,
--   each with its own delivery address)
-- - Porter tracking fields
-- - Technician bucket enhancements
-- - OTP delivery to sales email
-- - POD (Proof of Delivery) — photo upload + e-sign
-- - Technician reached / location capture
-- Additive + idempotent.
-- ============================================================

-- 1. Per-serial delivery addresses on sales_order_serials
ALTER TABLE sales_order_serials
  ADD COLUMN IF NOT EXISTS delivery_address  JSONB,
  ADD COLUMN IF NOT EXISTS delivery_notes    TEXT,
  ADD COLUMN IF NOT EXISTS is_wfh            BOOLEAN DEFAULT FALSE;
-- delivery_address: { name, phone, address, city, state, pincode, landmark }
-- is_wfh: true when technician delivers to employee's home address

-- 2. DC enhancements
ALTER TABLE delivery_challan_lines
  ADD COLUMN IF NOT EXISTS porter_tracking_id   VARCHAR(100),
  ADD COLUMN IF NOT EXISTS porter_order_id      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS porter_booking_url   TEXT,
  ADD COLUMN IF NOT EXISTS courier_tracking_url TEXT,
  ADD COLUMN IF NOT EXISTS dispatched_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reached_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tech_latitude        VARCHAR(64),
  ADD COLUMN IF NOT EXISTS tech_longitude       VARCHAR(64),
  ADD COLUMN IF NOT EXISTS serial_verified_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS serial_verified_no   VARCHAR(255),
  ADD COLUMN IF NOT EXISTS otp_code             VARCHAR(10),
  ADD COLUMN IF NOT EXISTS otp_sent_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS otp_verified_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pod_photo_url        TEXT,
  ADD COLUMN IF NOT EXISTS esign_url            TEXT,
  ADD COLUMN IF NOT EXISTS pod_submitted_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pod_submitted_by     INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS pod_type             VARCHAR(20),
  ADD COLUMN IF NOT EXISTS delivery_notes       TEXT;

-- 3. Update DC status to include full lifecycle
ALTER TABLE delivery_challan_lines
  DROP CONSTRAINT IF EXISTS delivery_challan_lines_status_check;
ALTER TABLE delivery_challan_lines
  ADD CONSTRAINT delivery_challan_lines_status_check
  CHECK (status IN (
    'pending',      -- DC created, not dispatched
    'processing',   -- being prepared / QC passed
    'shipped',      -- courier/porter dispatched
    'in_transit',   -- inhouse tech picked up
    'reached',      -- tech marked as reached at location
    'delivered',    -- OTP verified + POD submitted
    'rejected',     -- delivery rejected by customer
    'cancelled'
  ));

CREATE INDEX IF NOT EXISTS idx_dcl_delivery_person ON delivery_challan_lines (delivery_person_id);
CREATE INDEX IF NOT EXISTS idx_dcl_status2 ON delivery_challan_lines (status);

-- 4. Technician bucket view permissions
INSERT INTO permission_sections (section, description, sort_order)
VALUES ('technician_bucket', 'Delivery Technician Bucket', 176)
ON CONFLICT (section) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin',    'technician_bucket', true, false, true, false),
  ('manager',  'technician_bucket', true, false, true, false),
  ('sales',    'technician_bucket', true, false, false, false),
  ('dispatch', 'technician_bucket', true, false, true, false)
ON CONFLICT (role, section) DO NOTHING;

-- 5. Document sequences (best-effort: table may not exist in every deploy)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sm_document_sequences') THEN
    INSERT INTO sm_document_sequences (doc_type, last_value, prefix)
    VALUES ('delivery_challan', 0, 'DC-')
    ON CONFLICT (doc_type) DO NOTHING;
  END IF;
END $$;
