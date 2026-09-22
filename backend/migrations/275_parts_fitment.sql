-- 275: Part Fitment — laptop brand/model tagging for spare part units.
-- Additive only. Does not touch part_instances.brand/model or parts.default_brand/model
-- (those are the SPARE's brand/model — see asset_config_spare_*).

-- ---------------------------------------------------------------------------
-- 1. part_instances — authority for what a physical unit fits
-- ---------------------------------------------------------------------------
ALTER TABLE part_instances
  ADD COLUMN IF NOT EXISTS fitment VARCHAR(12) NOT NULL DEFAULT 'unset',
  ADD COLUMN IF NOT EXISTS fits_laptop_brand VARCHAR(120),
  ADD COLUMN IF NOT EXISTS fits_laptop_models TEXT[];

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'part_instances_fitment_check'
  ) THEN
    ALTER TABLE part_instances
      ADD CONSTRAINT part_instances_fitment_check
      CHECK (fitment IN ('unset', 'universal', 'specific'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_part_instances_fitment
  ON part_instances (fitment) WHERE fitment = 'specific';
CREATE INDEX IF NOT EXISTS idx_part_instances_fits_brand
  ON part_instances (LOWER(TRIM(fits_laptop_brand))) WHERE fits_laptop_brand IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. parts — GRN default only (compatible_brands / compatible_models already exist)
-- ---------------------------------------------------------------------------
ALTER TABLE parts
  ADD COLUMN IF NOT EXISTS default_fitment VARCHAR(12) NOT NULL DEFAULT 'unset';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'parts_default_fitment_check'
  ) THEN
    ALTER TABLE parts
      ADD CONSTRAINT parts_default_fitment_check
      CHECK (default_fitment IN ('unset', 'universal', 'specific'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_parts_compatible_models
  ON parts USING GIN (compatible_models);

-- ---------------------------------------------------------------------------
-- 3. app_settings — generic key/value store (do not add a third settings table)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
  setting_key   VARCHAR(100) PRIMARY KEY,
  setting_value JSONB NOT NULL,
  updated_by    INT REFERENCES users(user_id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_settings (setting_key, setting_value)
VALUES ('parts_fitment_enforcement', '"filter"')
ON CONFLICT (setting_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. part_movements — allow fitment audit types
-- ---------------------------------------------------------------------------
ALTER TABLE part_movements DROP CONSTRAINT IF EXISTS part_movements_type_check;
ALTER TABLE part_movements
  ADD CONSTRAINT part_movements_type_check
  CHECK (movement_type IN (
    'received', 'reserved', 'unreserved', 'installed',
    'returned_defective', 'returned_good', 'adjusted', 'discarded',
    'sent_to_vendor_repair', 'received_from_vendor_repair', 'scrapped',
    'fitment_retag', 'fitment_mismatch'
  ));
