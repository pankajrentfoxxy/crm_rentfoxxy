-- Asset Configuration Management — dynamic dropdown values for Asset Details forms.

CREATE TABLE IF NOT EXISTS asset_config_brands (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  status      VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  INT REFERENCES users(user_id),
  updated_by  INT REFERENCES users(user_id),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_config_brands_name
  ON asset_config_brands (LOWER(TRIM(name))) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS asset_config_models (
  id          SERIAL PRIMARY KEY,
  brand_id    INT NOT NULL REFERENCES asset_config_brands(id),
  name        VARCHAR(200) NOT NULL,
  status      VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  INT REFERENCES users(user_id),
  updated_by  INT REFERENCES users(user_id),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_config_models_brand_name
  ON asset_config_models (brand_id, LOWER(TRIM(name))) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_asset_config_models_brand ON asset_config_models(brand_id);

CREATE TABLE IF NOT EXISTS asset_config_processors (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  status      VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  INT REFERENCES users(user_id),
  updated_by  INT REFERENCES users(user_id),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_config_processors_name
  ON asset_config_processors (LOWER(TRIM(name))) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS asset_config_generations (
  id            SERIAL PRIMARY KEY,
  processor_id  INT NOT NULL REFERENCES asset_config_processors(id),
  name          VARCHAR(80) NOT NULL,
  status        VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    INT REFERENCES users(user_id),
  updated_by    INT REFERENCES users(user_id),
  deleted_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_config_generations_proc_name
  ON asset_config_generations (processor_id, LOWER(TRIM(name))) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_asset_config_generations_processor ON asset_config_generations(processor_id);

CREATE TABLE IF NOT EXISTS asset_config_ram (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(40) NOT NULL,
  status      VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  INT REFERENCES users(user_id),
  updated_by  INT REFERENCES users(user_id),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_config_ram_name
  ON asset_config_ram (LOWER(TRIM(name))) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS asset_config_storage (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(60) NOT NULL,
  status      VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  INT REFERENCES users(user_id),
  updated_by  INT REFERENCES users(user_id),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_config_storage_name
  ON asset_config_storage (LOWER(TRIM(name))) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS asset_config_gpu (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  status      VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  INT REFERENCES users(user_id),
  updated_by  INT REFERENCES users(user_id),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_config_gpu_name
  ON asset_config_gpu (LOWER(TRIM(name))) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS asset_config_screen_sizes (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(40) NOT NULL,
  status      VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  INT REFERENCES users(user_id),
  updated_by  INT REFERENCES users(user_id),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_config_screen_sizes_name
  ON asset_config_screen_sizes (LOWER(TRIM(name))) WHERE deleted_at IS NULL;

-- RBAC
INSERT INTO permission_sections (section, description, sort_order)
VALUES ('asset_configuration', 'Asset Configuration', 136)
ON CONFLICT (section) DO UPDATE SET description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT r.role, 'asset_configuration', TRUE, TRUE, TRUE, TRUE
  FROM (VALUES ('admin'), ('manager'), ('super_admin')) AS r(role)
ON CONFLICT (role, section) DO UPDATE SET
  can_view = EXCLUDED.can_view,
  can_create = EXCLUDED.can_create,
  can_edit = EXCLUDED.can_edit,
  can_delete = EXCLUDED.can_delete;

-- Seed defaults (only when tables are empty)
DO $$
DECLARE bid INT; pid INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM asset_config_brands WHERE deleted_at IS NULL LIMIT 1) THEN
    INSERT INTO asset_config_brands (name) VALUES
      ('Apple'),('Assamble'),('Asus'),('Dell'),('Dummy Brand'),('HP'),('Lenovo'),('Rentfoxxy');
  END IF;

  SELECT id INTO bid FROM asset_config_brands WHERE LOWER(name)='dell' AND deleted_at IS NULL LIMIT 1;
  IF bid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM asset_config_models WHERE brand_id=bid AND deleted_at IS NULL LIMIT 1) THEN
    INSERT INTO asset_config_models (brand_id, name) VALUES
      (bid,'Latitude 3410'),(bid,'Latitude 3510'),(bid,'Latitude 5410'),(bid,'Latitude 5510'),
      (bid,'Inspiron 14'),(bid,'Inspiron 15'),(bid,'Vostro 3400'),(bid,'XPS 13'),(bid,'Other');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM asset_config_processors WHERE deleted_at IS NULL LIMIT 1) THEN
    INSERT INTO asset_config_processors (name) VALUES
      ('Intel Core i3'),('Intel Core i5'),('Intel Core i7'),('Intel Core i9'),
      ('AMD Ryzen 3'),('AMD Ryzen 5'),('AMD Ryzen 7'),
      ('Apple M1'),('Apple M2'),('Apple M3');
  END IF;

  SELECT id INTO pid FROM asset_config_processors WHERE LOWER(name)='intel core i5' AND deleted_at IS NULL LIMIT 1;
  IF pid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM asset_config_generations WHERE processor_id=pid AND deleted_at IS NULL LIMIT 1) THEN
    INSERT INTO asset_config_generations (processor_id, name) VALUES
      (pid,'10th Gen'),(pid,'11th Gen'),(pid,'12th Gen'),(pid,'13th Gen'),(pid,'14th Gen');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM asset_config_ram WHERE deleted_at IS NULL LIMIT 1) THEN
    INSERT INTO asset_config_ram (name) VALUES
      ('4 GB'),('8 GB'),('12 GB'),('16 GB'),('24 GB'),('32 GB'),('64 GB');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM asset_config_storage WHERE deleted_at IS NULL LIMIT 1) THEN
    INSERT INTO asset_config_storage (name) VALUES
      ('128 GB SSD'),('256 GB SSD'),('512 GB SSD'),('1 TB SSD'),
      ('256 GB HDD'),('512 GB HDD'),('1 TB HDD'),('2 TB HDD');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM asset_config_gpu WHERE deleted_at IS NULL LIMIT 1) THEN
    INSERT INTO asset_config_gpu (name) VALUES
      ('Integrated'),('NVIDIA GTX 1650'),('NVIDIA RTX 3050'),
      ('NVIDIA RTX 3060'),('NVIDIA RTX 4060'),('AMD Radeon RX'),('Other Dedicated');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM asset_config_screen_sizes WHERE deleted_at IS NULL LIMIT 1) THEN
    INSERT INTO asset_config_screen_sizes (name) VALUES
      ('11.6"'),('13.3"'),('14"'),('15.6"'),('16"'),('17.3"');
  END IF;
END $$;
