-- Spare parts master catalog: name, category, type, brand for SPO + GRN stock.
BEGIN;

ALTER TABLE vendor_spare_parts_catalog
  ADD COLUMN IF NOT EXISTS part_type VARCHAR(128),
  ADD COLUMN IF NOT EXISTS default_brand VARCHAR(128),
  ADD COLUMN IF NOT EXISTS erp_spare_part_id INT;

CREATE INDEX IF NOT EXISTS idx_vspc_category_name
  ON vendor_spare_parts_catalog (category, name)
  WHERE active = TRUE;

COMMIT;
