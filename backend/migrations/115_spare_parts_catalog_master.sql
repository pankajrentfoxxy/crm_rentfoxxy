-- Spare parts master catalog.
-- Merges migration 089 (floor inventory link) + 115 (type/brand/ERP id).
-- Safe on prod that only has the base table from migration 034.
BEGIN;

-- 089: link vendor_spare_parts_catalog -> floor parts inventory
ALTER TABLE vendor_spare_parts_catalog
  ADD COLUMN IF NOT EXISTS floor_part_id     INT REFERENCES parts(part_id),
  ADD COLUMN IF NOT EXISTS category          VARCHAR(50),
  ADD COLUMN IF NOT EXISTS specifications    TEXT,
  ADD COLUMN IF NOT EXISTS compatible_brands TEXT[];

-- 115: spare PO master fields
ALTER TABLE vendor_spare_parts_catalog
  ADD COLUMN IF NOT EXISTS part_type VARCHAR(128),
  ADD COLUMN IF NOT EXISTS default_brand VARCHAR(128),
  ADD COLUMN IF NOT EXISTS erp_spare_part_id INT;

ALTER TABLE vendor_spare_parts_purchase_orders
  ADD COLUMN IF NOT EXISTS has_floor_parts BOOLEAN DEFAULT FALSE;

INSERT INTO sm_document_sequences (doc_type, last_value, prefix)
VALUES ('spare_po', 0, 'SP-PO-')
ON CONFLICT (doc_type) DO NOTHING;

-- Back-link existing floor parts into catalog when not yet linked
INSERT INTO vendor_spare_parts_catalog (name, active, floor_part_id, category)
SELECT p.part_name, TRUE, p.part_id, COALESCE(NULLIF(TRIM(p.category), ''), 'general')
FROM parts p
WHERE NOT EXISTS (
  SELECT 1 FROM vendor_spare_parts_catalog v WHERE v.floor_part_id = p.part_id
);

CREATE INDEX IF NOT EXISTS idx_vspc_category_name
  ON vendor_spare_parts_catalog (category, name)
  WHERE active = TRUE;

COMMIT;
