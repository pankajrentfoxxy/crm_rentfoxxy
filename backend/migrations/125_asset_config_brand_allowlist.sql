-- Keep only approved laptop brands; remove Acer, MSI, Samsung, Toshiba, Other, etc.

DO $$
DECLARE
  allowed TEXT[] := ARRAY[
    'Apple', 'Assamble', 'Asus', 'Dell', 'Dummy Brand', 'HP', 'Lenovo', 'Rentfoxxy'
  ];
  brand_name TEXT;
  brand_id INT;
BEGIN
  FOREACH brand_name IN ARRAY allowed LOOP
    SELECT id INTO brand_id
      FROM asset_config_brands
     WHERE deleted_at IS NULL AND LOWER(TRIM(name)) = LOWER(TRIM(brand_name))
     LIMIT 1;
    IF brand_id IS NULL THEN
      INSERT INTO asset_config_brands (name) VALUES (TRIM(brand_name));
    END IF;
  END LOOP;

  UPDATE asset_config_brand_processor_generations bpg
     SET deleted_at = NOW(), updated_at = NOW()
    FROM asset_config_brand_processors bp
    JOIN asset_config_brands b ON b.id = bp.brand_id
   WHERE bpg.brand_processor_id = bp.id
     AND bpg.deleted_at IS NULL
     AND b.deleted_at IS NULL
     AND LOWER(TRIM(b.name)) NOT IN (SELECT LOWER(TRIM(x)) FROM unnest(allowed) AS x);

  UPDATE asset_config_brand_processors bp
     SET deleted_at = NOW(), updated_at = NOW()
    FROM asset_config_brands b
   WHERE bp.brand_id = b.id
     AND bp.deleted_at IS NULL
     AND b.deleted_at IS NULL
     AND LOWER(TRIM(b.name)) NOT IN (SELECT LOWER(TRIM(x)) FROM unnest(allowed) AS x);

  UPDATE asset_config_models m
     SET deleted_at = NOW(), updated_at = NOW()
    FROM asset_config_brands b
   WHERE m.brand_id = b.id
     AND m.deleted_at IS NULL
     AND b.deleted_at IS NULL
     AND LOWER(TRIM(b.name)) NOT IN (SELECT LOWER(TRIM(x)) FROM unnest(allowed) AS x);

  UPDATE asset_config_brands
     SET deleted_at = NOW(), updated_at = NOW(), status = 'inactive'
   WHERE deleted_at IS NULL
     AND LOWER(TRIM(name)) NOT IN (SELECT LOWER(TRIM(x)) FROM unnest(allowed) AS x);

  INSERT INTO asset_config_models (brand_id, name)
  SELECT b.id, 'Other'
    FROM asset_config_brands b
   WHERE b.deleted_at IS NULL
     AND LOWER(TRIM(b.name)) IN (LOWER('Assamble'), LOWER('Dummy Brand'), LOWER('Rentfoxxy'))
     AND NOT EXISTS (
       SELECT 1 FROM asset_config_models m
        WHERE m.brand_id = b.id AND m.deleted_at IS NULL AND LOWER(TRIM(m.name)) = 'other'
     );
END $$;
