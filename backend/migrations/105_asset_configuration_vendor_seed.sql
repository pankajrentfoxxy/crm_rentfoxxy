-- Seed asset configuration with vendor-management brand → model mappings (idempotent).

CREATE OR REPLACE FUNCTION _asset_cfg_ensure_brand(p_name TEXT) RETURNS INT AS $$
DECLARE v_id INT;
BEGIN
  SELECT id INTO v_id FROM asset_config_brands
   WHERE deleted_at IS NULL AND LOWER(TRIM(name)) = LOWER(TRIM(p_name)) LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO asset_config_brands (name) VALUES (TRIM(p_name)) RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION _asset_cfg_ensure_model(p_brand TEXT, p_model TEXT) RETURNS VOID AS $$
DECLARE v_brand_id INT;
BEGIN
  v_brand_id := _asset_cfg_ensure_brand(p_brand);
  IF NOT EXISTS (
    SELECT 1 FROM asset_config_models
     WHERE brand_id = v_brand_id AND deleted_at IS NULL
       AND LOWER(TRIM(name)) = LOWER(TRIM(p_model))
  ) THEN
    INSERT INTO asset_config_models (brand_id, name) VALUES (v_brand_id, TRIM(p_model));
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION _asset_cfg_ensure_simple(p_table TEXT, p_name TEXT) RETURNS VOID AS $$
BEGIN
  EXECUTE format(
    'INSERT INTO %I (name)
       SELECT $1 WHERE NOT EXISTS (
         SELECT 1 FROM %I WHERE deleted_at IS NULL AND LOWER(TRIM(name)) = LOWER(TRIM($1))
       )', p_table, p_table
  ) USING TRIM(p_name);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION _asset_cfg_ensure_generation(p_processor TEXT, p_gen TEXT) RETURNS VOID AS $$
DECLARE v_pid INT;
BEGIN
  SELECT id INTO v_pid FROM asset_config_processors
   WHERE deleted_at IS NULL AND LOWER(TRIM(name)) = LOWER(TRIM(p_processor)) LIMIT 1;
  IF v_pid IS NULL THEN
    INSERT INTO asset_config_processors (name) VALUES (TRIM(p_processor)) RETURNING id INTO v_pid;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM asset_config_generations
     WHERE processor_id = v_pid AND deleted_at IS NULL
       AND LOWER(TRIM(name)) = LOWER(TRIM(p_gen))
  ) THEN
    INSERT INTO asset_config_generations (processor_id, name) VALUES (v_pid, TRIM(p_gen));
  END IF;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  gens TEXT[] := ARRAY['6th Gen','7th Gen','8th Gen','9th Gen','10th Gen','11th Gen','12th Gen','13th Gen','14th Gen'];
  procs TEXT[] := ARRAY[
    'Intel Core i3','Intel Core i5','Intel Core i7','Intel Core i9',
    'AMD Ryzen 3','AMD Ryzen 5','AMD Ryzen 7','Apple M1','Apple M2','Apple M3'
  ];
  p TEXT; g TEXT;
BEGIN
  -- Brands + models (vendor PO catalog parity)
  PERFORM _asset_cfg_ensure_model('Dell', 'Latitude 5400');
  PERFORM _asset_cfg_ensure_model('Dell', 'Latitude 5410');
  PERFORM _asset_cfg_ensure_model('Dell', 'Latitude 5420');
  PERFORM _asset_cfg_ensure_model('Dell', 'Latitude 5430');
  PERFORM _asset_cfg_ensure_model('Dell', 'Latitude 7440');
  PERFORM _asset_cfg_ensure_model('Dell', 'Inspiron 15 3000');
  PERFORM _asset_cfg_ensure_model('Dell', 'Inspiron 15 5000');
  PERFORM _asset_cfg_ensure_model('Dell', 'XPS 13');
  PERFORM _asset_cfg_ensure_model('Dell', 'XPS 15');
  PERFORM _asset_cfg_ensure_model('Dell', 'Precision 3550');
  PERFORM _asset_cfg_ensure_model('Dell', 'Precision 5560');
  PERFORM _asset_cfg_ensure_model('Dell', 'Other');

  PERFORM _asset_cfg_ensure_model('HP', 'EliteBook 840 G6');
  PERFORM _asset_cfg_ensure_model('HP', 'EliteBook 840 G7');
  PERFORM _asset_cfg_ensure_model('HP', 'EliteBook 840 G8');
  PERFORM _asset_cfg_ensure_model('HP', 'EliteBook 850 G8');
  PERFORM _asset_cfg_ensure_model('HP', 'ProBook 440 G8');
  PERFORM _asset_cfg_ensure_model('HP', 'ProBook 450 G8');
  PERFORM _asset_cfg_ensure_model('HP', 'Pavilion 15');
  PERFORM _asset_cfg_ensure_model('HP', 'ZBook Firefly 14');
  PERFORM _asset_cfg_ensure_model('HP', 'ZBook Studio');
  PERFORM _asset_cfg_ensure_model('HP', 'Other');

  PERFORM _asset_cfg_ensure_model('Lenovo', 'ThinkPad T14');
  PERFORM _asset_cfg_ensure_model('Lenovo', 'ThinkPad T14s');
  PERFORM _asset_cfg_ensure_model('Lenovo', 'ThinkPad L14');
  PERFORM _asset_cfg_ensure_model('Lenovo', 'ThinkPad X1 Carbon');
  PERFORM _asset_cfg_ensure_model('Lenovo', 'ThinkPad E14');
  PERFORM _asset_cfg_ensure_model('Lenovo', 'IdeaPad 3');
  PERFORM _asset_cfg_ensure_model('Lenovo', 'IdeaPad 5');
  PERFORM _asset_cfg_ensure_model('Lenovo', 'Legion 5');
  PERFORM _asset_cfg_ensure_model('Lenovo', 'Yoga 7i');
  PERFORM _asset_cfg_ensure_model('Lenovo', 'Other');

  PERFORM _asset_cfg_ensure_model('Apple', 'MacBook Air M1');
  PERFORM _asset_cfg_ensure_model('Apple', 'MacBook Air M2');
  PERFORM _asset_cfg_ensure_model('Apple', 'MacBook Air M3');
  PERFORM _asset_cfg_ensure_model('Apple', 'MacBook Pro 13');
  PERFORM _asset_cfg_ensure_model('Apple', 'MacBook Pro 14');
  PERFORM _asset_cfg_ensure_model('Apple', 'MacBook Pro 16');
  PERFORM _asset_cfg_ensure_model('Apple', 'Other');

  PERFORM _asset_cfg_ensure_model('Asus', 'VivoBook 15');
  PERFORM _asset_cfg_ensure_model('Asus', 'ZenBook 14');
  PERFORM _asset_cfg_ensure_model('Asus', 'ExpertBook B1');
  PERFORM _asset_cfg_ensure_model('Asus', 'ROG Strix');
  PERFORM _asset_cfg_ensure_model('Asus', 'Other');

  PERFORM _asset_cfg_ensure_model('Assamble', 'Other');
  PERFORM _asset_cfg_ensure_model('Dummy Brand', 'Other');
  PERFORM _asset_cfg_ensure_model('Rentfoxxy', 'Other');

  FOREACH p IN ARRAY procs LOOP
    PERFORM _asset_cfg_ensure_simple('asset_config_processors', p);
    FOREACH g IN ARRAY gens LOOP
      PERFORM _asset_cfg_ensure_generation(p, g);
    END LOOP;
  END LOOP;

  PERFORM _asset_cfg_ensure_simple('asset_config_ram', '4 GB');
  PERFORM _asset_cfg_ensure_simple('asset_config_ram', '8 GB');
  PERFORM _asset_cfg_ensure_simple('asset_config_ram', '12 GB');
  PERFORM _asset_cfg_ensure_simple('asset_config_ram', '16 GB');
  PERFORM _asset_cfg_ensure_simple('asset_config_ram', '24 GB');
  PERFORM _asset_cfg_ensure_simple('asset_config_ram', '32 GB');
  PERFORM _asset_cfg_ensure_simple('asset_config_ram', '64 GB');

  PERFORM _asset_cfg_ensure_simple('asset_config_storage', '128 GB SSD');
  PERFORM _asset_cfg_ensure_simple('asset_config_storage', '256 GB SSD');
  PERFORM _asset_cfg_ensure_simple('asset_config_storage', '512 GB SSD');
  PERFORM _asset_cfg_ensure_simple('asset_config_storage', '1 TB SSD');
  PERFORM _asset_cfg_ensure_simple('asset_config_storage', '256 GB HDD');
  PERFORM _asset_cfg_ensure_simple('asset_config_storage', '512 GB HDD');
  PERFORM _asset_cfg_ensure_simple('asset_config_storage', '1 TB HDD');

  PERFORM _asset_cfg_ensure_simple('asset_config_gpu', 'Integrated');
  PERFORM _asset_cfg_ensure_simple('asset_config_gpu', 'NVIDIA GTX 1650');
  PERFORM _asset_cfg_ensure_simple('asset_config_gpu', 'NVIDIA RTX 3050');
  PERFORM _asset_cfg_ensure_simple('asset_config_gpu', 'NVIDIA RTX 3060');
  PERFORM _asset_cfg_ensure_simple('asset_config_gpu', 'NVIDIA RTX 4060');
  PERFORM _asset_cfg_ensure_simple('asset_config_gpu', 'AMD Radeon RX');
  PERFORM _asset_cfg_ensure_simple('asset_config_gpu', 'Other Dedicated');

  PERFORM _asset_cfg_ensure_simple('asset_config_screen_sizes', '11.6"');
  PERFORM _asset_cfg_ensure_simple('asset_config_screen_sizes', '13.3"');
  PERFORM _asset_cfg_ensure_simple('asset_config_screen_sizes', '14"');
  PERFORM _asset_cfg_ensure_simple('asset_config_screen_sizes', '15.6"');
  PERFORM _asset_cfg_ensure_simple('asset_config_screen_sizes', '16"');
  PERFORM _asset_cfg_ensure_simple('asset_config_screen_sizes', '17.3"');
END $$;

DROP FUNCTION IF EXISTS _asset_cfg_ensure_generation(TEXT, TEXT);
DROP FUNCTION IF EXISTS _asset_cfg_ensure_simple(TEXT, TEXT);
DROP FUNCTION IF EXISTS _asset_cfg_ensure_model(TEXT, TEXT);
DROP FUNCTION IF EXISTS _asset_cfg_ensure_brand(TEXT);
