-- Vendor repair DC: dispatch mode + delivery-to-vendor tracking (parity with sales DC)

ALTER TABLE vendor_repair_delivery_challans
  ADD COLUMN IF NOT EXISTS ship_by VARCHAR(20),
  ADD COLUMN IF NOT EXISTS dispatch_mode VARCHAR(20),
  ADD COLUMN IF NOT EXISTS courier_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS awb_number VARCHAR(128),
  ADD COLUMN IF NOT EXISTS courier_tracking_url TEXT,
  ADD COLUMN IF NOT EXISTS porter_tracking_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS porter_order_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS porter_booking_url TEXT,
  ADD COLUMN IF NOT EXISTS delivery_person_id INTEGER,
  ADD COLUMN IF NOT EXISTS vendor_delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vendor_delivered_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vrdc_dispatch_mode ON vendor_repair_delivery_challans(dispatch_mode);
CREATE INDEX IF NOT EXISTS idx_vrdc_vendor_delivered ON vendor_repair_delivery_challans(vendor_delivered_at);
