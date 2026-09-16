-- Floor catalog had charger / power cable under general, so they were hidden
-- from Dispatch Chargers warehouse stock (filters category = 'power').

UPDATE parts
   SET category = 'power',
       part_type = CASE
         WHEN COALESCE(part_type, '') IN ('', 'general') THEN 'power'
         ELSE part_type
       END
 WHERE LOWER(part_name) IN ('laptop charger power adapter', 'power cable')
   AND COALESCE(category, 'general') <> 'power';

UPDATE vendor_spare_parts_catalog
   SET category = 'power',
       updated_at = NOW()
 WHERE floor_part_id IN (
         SELECT part_id FROM parts
          WHERE LOWER(part_name) IN ('laptop charger power adapter', 'power cable')
       )
   AND COALESCE(category, 'general') <> 'power';
