-- 405: My Deliveries — hand-over to the vendor from the technician's phone
-- (claude/carret-remaining-build.md, wave 2 builder 11).
--
-- Vendor repair challans (VRDC) sent by hand can now be walked to the vendor by
-- the assigned technician: reached (GPS) → vendor signature (+ optional photo)
-- → "delivered to vendor". Until now only the desk could mark that, with no
-- proof at all. Vendor return challans (VRTDC) already had reached + signature;
-- their optional handover photo was uploaded and then thrown away — it gets a
-- column here. Additive only; nothing existing is rewritten.

ALTER TABLE vendor_repair_delivery_challans
  ADD COLUMN IF NOT EXISTS vendor_reached_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vendor_reached_latitude VARCHAR(40),
  ADD COLUMN IF NOT EXISTS vendor_reached_longitude VARCHAR(40),
  ADD COLUMN IF NOT EXISTS vendor_delivery_esign_url TEXT,
  ADD COLUMN IF NOT EXISTS vendor_delivery_photo_path TEXT,
  ADD COLUMN IF NOT EXISTS vendor_delivery_signer_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS vendor_delivery_notes TEXT;

ALTER TABLE vendor_return_delivery_challans
  ADD COLUMN IF NOT EXISTS delivery_photo_path TEXT,
  ADD COLUMN IF NOT EXISTS delivery_signer_name VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_vrdc_field_handover
  ON vendor_repair_delivery_challans (delivery_person_id)
  WHERE status = 'dispatched' AND ship_by = 'by_hand' AND vendor_delivered_at IS NULL;
