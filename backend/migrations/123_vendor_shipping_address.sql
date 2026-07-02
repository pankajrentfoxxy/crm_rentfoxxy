-- Vendor registered vs shipping address (mirrors customer pattern)

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS shipping_same BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS shipping_address TEXT,
  ADD COLUMN IF NOT EXISTS shipping_city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS shipping_state VARCHAR(128),
  ADD COLUMN IF NOT EXISTS shipping_pincode VARCHAR(10);
