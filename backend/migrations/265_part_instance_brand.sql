-- Brand on tracked part units (part_instances).
-- The original file was recorded in QA's schema_migrations on 21 Sep 2026 but
-- never committed; rebuilt 1 Oct 2026 from QA's live catalog. 267 re-adds the
-- column IF NOT EXISTS and adds model.
ALTER TABLE part_instances
  ADD COLUMN IF NOT EXISTS brand VARCHAR(120);

CREATE INDEX IF NOT EXISTS idx_part_instances_brand
  ON part_instances (LOWER(brand)) WHERE brand IS NOT NULL;
