-- Multiple photos on physical-part inward units and outward transactions.
ALTER TABLE physical_dead_parts
  ADD COLUMN IF NOT EXISTS inward_photo_paths JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE physical_part_outwards
  ADD COLUMN IF NOT EXISTS photo_paths JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE physical_dead_parts
   SET inward_photo_paths = jsonb_build_array(inward_photo_path)
 WHERE (inward_photo_paths IS NULL OR inward_photo_paths = '[]'::jsonb)
   AND inward_photo_path IS NOT NULL
   AND inward_photo_path <> '';

UPDATE physical_part_outwards
   SET photo_paths = jsonb_build_array(photo_path)
 WHERE (photo_paths IS NULL OR photo_paths = '[]'::jsonb)
   AND photo_path IS NOT NULL
   AND photo_path <> '';
