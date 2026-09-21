-- Persist spare Brand + Model on tracked part units (Parts Inventory).
ALTER TABLE part_instances
  ADD COLUMN IF NOT EXISTS brand VARCHAR(120),
  ADD COLUMN IF NOT EXISTS model VARCHAR(120);

CREATE INDEX IF NOT EXISTS idx_part_instances_brand
  ON part_instances (brand) WHERE brand IS NOT NULL;
