-- 399 — Dead / physical parts outward (Part DC): keep the whole transport record.
--
-- The approve & generate Part DC step validates vehicle number (in-house) and
-- the pickup person + mobile (vendor / buyer pickup) through the shared
-- dispatchPayloadFromBody(), but physical_part_outwards had no columns for
-- them, so they were required on screen and then thrown away. Additive only.
ALTER TABLE physical_part_outwards
  ADD COLUMN IF NOT EXISTS vehicle_number VARCHAR(20),
  ADD COLUMN IF NOT EXISTS vendor_pickup_person VARCHAR(255),
  ADD COLUMN IF NOT EXISTS vendor_pickup_mobile VARCHAR(20),
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by INTEGER,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
