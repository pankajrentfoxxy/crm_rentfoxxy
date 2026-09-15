-- Merge duplicate floor part "ADAPTER" (part_id 34) into
-- "Laptop Charger Power Adapter" (part_id 12).
-- Safe to re-run: no-ops when the source row is already gone.

DO $$
DECLARE
  src_id  INT;
  dest_id INT;
BEGIN
  SELECT part_id INTO dest_id
    FROM parts
   WHERE LOWER(part_name) = 'laptop charger power adapter'
   ORDER BY part_id
   LIMIT 1;

  SELECT part_id INTO src_id
    FROM parts
   WHERE part_id <> COALESCE(dest_id, 0)
     AND LOWER(part_name) = 'adapter'
   ORDER BY part_id
   LIMIT 1;

  IF dest_id IS NULL THEN
    RAISE EXCEPTION 'Laptop Charger Power Adapter not found';
  END IF;

  IF src_id IS NULL THEN
    RAISE NOTICE 'ADAPTER already merged into part_id %', dest_id;
    RETURN;
  END IF;

  UPDATE part_instances SET part_id = dest_id WHERE part_id = src_id;
  UPDATE part_movements SET part_id = dest_id WHERE part_id = src_id;
  UPDATE part_requests SET part_id = dest_id WHERE part_id = src_id;
  UPDATE part_requests SET old_part_part_id = dest_id WHERE old_part_part_id = src_id;
  UPDATE scrap_challan_items SET part_id = dest_id WHERE part_id = src_id;
  UPDATE support_challan_items SET part_id = dest_id WHERE part_id = src_id;
  UPDATE support_part_laptop_costs SET part_id = dest_id WHERE part_id = src_id;
  UPDATE support_part_requests SET part_id = dest_id WHERE part_id = src_id;
  UPDATE ticket_parts SET part_id = dest_id WHERE part_id = src_id;
  UPDATE vendor_repair_dc_part_items SET part_id = dest_id WHERE part_id = src_id;
  UPDATE dispatch_charger_requests SET part_id = dest_id WHERE part_id = src_id;
  UPDATE dispatch_charger_units
     SET part_id = dest_id,
         part_name = 'Laptop Charger Power Adapter'
   WHERE part_id = src_id;

  UPDATE vendor_spare_parts_catalog
     SET floor_part_id = dest_id,
         category = 'power',
         updated_at = NOW()
   WHERE floor_part_id = src_id;

  -- Historical spare POs still store the old floor id on each line.
  UPDATE vendor_spare_parts_purchase_orders
     SET line_items = (
       SELECT COALESCE(jsonb_agg(
         CASE
           WHEN (elem->>'floor_part_id') = src_id::text
             OR (elem->>'parts_catalog_id') = src_id::text
           THEN elem
             || jsonb_build_object(
                  'floor_part_id', dest_id,
                  'parts_catalog_id', dest_id
                )
           ELSE elem
         END
       ), '[]'::jsonb)
         FROM jsonb_array_elements(COALESCE(line_items, '[]'::jsonb)) elem
     )
   WHERE EXISTS (
           SELECT 1
             FROM jsonb_array_elements(COALESCE(line_items, '[]'::jsonb)) e
            WHERE (e->>'floor_part_id') = src_id::text
               OR (e->>'parts_catalog_id') = src_id::text
         );

  UPDATE parts
     SET quantity = (
           SELECT COUNT(*)::int
             FROM part_instances
            WHERE part_id = dest_id
              AND status = 'in_stock'
         ),
         category = 'power',
         part_type = CASE
           WHEN COALESCE(part_type, '') IN ('', 'general') THEN 'power'
           ELSE part_type
         END,
         updated_at = NOW()
   WHERE part_id = dest_id;

  DELETE FROM parts WHERE part_id = src_id;
END $$;

-- Hide leftover vendor-catalog aliases so new SPOs pick the merged name.
UPDATE vendor_spare_parts_catalog
   SET active = false,
       updated_at = NOW()
 WHERE LOWER(name) = 'adapter'
   AND floor_part_id = (
         SELECT part_id FROM parts
          WHERE LOWER(part_name) = 'laptop charger power adapter'
          ORDER BY part_id LIMIT 1
       );
