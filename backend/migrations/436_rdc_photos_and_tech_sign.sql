-- 436: Photos and technician signature on a Return DC collected from
-- My deliveries (16 Oct 2026).
--
-- A Return DC without support tickets (e.g. an end-of-rental return) is
-- collected from My deliveries, challan-wide. Its laptops have no support
-- item, so their 6 photos are keyed by Return DC + laptop code instead; the
-- technician signs the challan itself. Support pickups keep item_id. Additive only.

ALTER TABLE support_item_photos ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE support_item_photos ADD COLUMN IF NOT EXISTS dc_number VARCHAR(80);
ALTER TABLE support_item_photos ADD COLUMN IF NOT EXISTS asset_code VARCHAR(120);
ALTER TABLE support_item_photos DROP CONSTRAINT IF EXISTS support_item_photos_owner_check;
ALTER TABLE support_item_photos ADD CONSTRAINT support_item_photos_owner_check
  CHECK (item_id IS NOT NULL OR (dc_number IS NOT NULL AND asset_code IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS uq_support_item_photos_rdc
  ON support_item_photos (dc_number, asset_code, slot) WHERE item_id IS NULL;

ALTER TABLE delivery_challan_lines ADD COLUMN IF NOT EXISTS technician_esign_url TEXT;
ALTER TABLE delivery_challan_lines ADD COLUMN IF NOT EXISTS technician_esign_at TIMESTAMPTZ;
ALTER TABLE delivery_challan_lines ADD COLUMN IF NOT EXISTS technician_esign_name TEXT;
ALTER TABLE delivery_challan_lines ADD COLUMN IF NOT EXISTS technician_esign_by INT;
