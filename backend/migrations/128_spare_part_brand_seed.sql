-- Default Spare Part Brand master list (independent from laptop brands).

DO $$
DECLARE
  allowed TEXT[] := ARRAY[
    'OEM', 'Techie', 'Lapcare', 'Maxelon', 'Simmtronics', 'WD', 'HP', 'Intel',
    'Sandisk', 'Samsung', 'SK Hynix', 'Compatible', 'Crucial', 'EVM', 'Micron',
    'Consistent', 'Geonix', 'V-Trust'
  ];
  brand_name TEXT;
BEGIN
  FOREACH brand_name IN ARRAY allowed LOOP
    INSERT INTO asset_config_spare_brands (name, status)
    SELECT TRIM(brand_name), 'active'
     WHERE NOT EXISTS (
       SELECT 1 FROM asset_config_spare_brands sb
        WHERE sb.deleted_at IS NULL
          AND LOWER(TRIM(sb.name)) = LOWER(TRIM(brand_name))
     );
  END LOOP;

  -- Ensure seeded brands are active (in case any were inactive).
  UPDATE asset_config_spare_brands
     SET status = 'active', updated_at = NOW()
   WHERE deleted_at IS NULL
     AND LOWER(TRIM(name)) IN (SELECT LOWER(TRIM(x)) FROM unnest(allowed) AS x);
END $$;
