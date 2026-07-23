node backend/scripts/run-migration-168.js-- Parts catalog specs (display) + battery capture on floor part requests.
-- Idempotent.

ALTER TABLE parts
  ADD COLUMN IF NOT EXISTS model_number VARCHAR(120),
  ADD COLUMN IF NOT EXISTS pin_size     VARCHAR(60);

ALTER TABLE part_requests
  ADD COLUMN IF NOT EXISTS battery_model_number VARCHAR(120),
  ADD COLUMN IF NOT EXISTS battery_photos       JSONB;

-- Optional mirror on spare-parts master catalog (when linked via floor_part_id).
ALTER TABLE vendor_spare_parts_catalog
  ADD COLUMN IF NOT EXISTS model_number VARCHAR(120),
  ADD COLUMN IF NOT EXISTS pin_size     VARCHAR(60);

COMMENT ON COLUMN parts.model_number IS 'Catalog model number (display / auto-fill)';
COMMENT ON COLUMN parts.pin_size IS 'Pin size reference (display-only on floor)';
COMMENT ON COLUMN part_requests.battery_model_number IS 'Installed battery model — required when part category is battery';
COMMENT ON COLUMN part_requests.battery_photos IS 'JSONB array of uploaded photo URLs for battery parts';
