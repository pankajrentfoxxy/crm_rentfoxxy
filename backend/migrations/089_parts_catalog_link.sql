-- ============================================================
-- Migration 089: Connect SPO catalog to floor parts inventory
-- Fixes the disconnect between vendor_spare_parts_catalog (SPO form)
-- and parts (floor inventory) so GRN receive can create PRT instances.
-- ============================================================

-- 1. Link vendor_spare_parts_catalog -> parts + add category/specs
ALTER TABLE vendor_spare_parts_catalog
  ADD COLUMN IF NOT EXISTS floor_part_id     INT REFERENCES parts(part_id),
  ADD COLUMN IF NOT EXISTS category          VARCHAR(50),
  ADD COLUMN IF NOT EXISTS specifications    TEXT,
  ADD COLUMN IF NOT EXISTS compatible_brands TEXT[];

-- 2. Quick flag on SPOs that contain floor-linked parts
ALTER TABLE vendor_spare_parts_purchase_orders
  ADD COLUMN IF NOT EXISTS has_floor_parts BOOLEAN DEFAULT FALSE;

-- 3. Document sequence for spare PO numbers (idempotent)
INSERT INTO sm_document_sequences (doc_type, last_value, prefix)
VALUES ('spare_po', 0, 'SP-PO-')
ON CONFLICT (doc_type) DO NOTHING;

-- 4. Seed catalog entries from existing floor parts and link them.
--    parts.category already uses ram/storage/battery/keyboard/... values.
INSERT INTO vendor_spare_parts_catalog (name, active, floor_part_id, category)
SELECT p.part_name, true, p.part_id, p.category
FROM parts p
WHERE NOT EXISTS (
  SELECT 1 FROM vendor_spare_parts_catalog v WHERE v.floor_part_id = p.part_id
);
