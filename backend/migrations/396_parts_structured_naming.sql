-- 396: Part naming redesign (wave 2, builder 8).
--
-- A catalogue part is category + kind (parts.part_type) + specs + fits, and its
-- name is generated from those (backend/constants/partNaming.js) unless the
-- user sets an explicit override. Additive and idempotent: existing rows keep
-- their names; specs / spec_key stay NULL until the part is edited in the new
-- form or the reviewed clean-up (scripts/apply-part-naming-cleanup.js) runs.

ALTER TABLE parts
  ADD COLUMN IF NOT EXISTS specs         JSONB,
  ADD COLUMN IF NOT EXISTS name_override BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS spec_key      VARCHAR(400);

COMMENT ON COLUMN parts.specs IS
  'Per-kind specification fields (capacity, ram_type, size, watt, detail, unit…); _was = name before the naming clean-up';
COMMENT ON COLUMN parts.name_override IS
  'TRUE = part_name typed by the user; FALSE = generated from category + kind + specs + fits';
COMMENT ON COLUMN parts.spec_key IS
  'category|kind|specs|fits identity; one live part per key (duplicates refused)';
COMMENT ON COLUMN parts.part_type IS
  'Kind within the category (ram, ssd, battery, d_panel…) — set from the structure, not typed';

-- One live (not archived) part per identity. Legacy rows have NULL and are not constrained.
CREATE UNIQUE INDEX IF NOT EXISTS uq_parts_spec_key_live
  ON parts (spec_key)
  WHERE spec_key IS NOT NULL AND archived IS NOT TRUE;
