-- Brand on physical (dead / outward) parts.
-- The original file was recorded in QA's schema_migrations on 21 Sep 2026 but
-- never committed; rebuilt 1 Oct 2026 from QA's live catalog.
ALTER TABLE physical_dead_parts
  ADD COLUMN IF NOT EXISTS brand VARCHAR(120);

CREATE INDEX IF NOT EXISTS idx_physical_dead_parts_brand
  ON physical_dead_parts (LOWER(brand)) WHERE brand IS NOT NULL;
