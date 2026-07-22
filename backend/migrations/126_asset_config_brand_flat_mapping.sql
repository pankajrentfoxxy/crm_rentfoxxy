-- Flat brand mapping: Brand multi-selects Models, Processors, and Generations independently.
-- RAM / Storage / GPU / Screen Size remain global masters (unchanged).

CREATE TABLE IF NOT EXISTS asset_config_brand_models (
  id          SERIAL PRIMARY KEY,
  brand_id    INT NOT NULL REFERENCES asset_config_brands(id) ON DELETE CASCADE,
  model_id    INT NOT NULL REFERENCES asset_config_models(id) ON DELETE CASCADE,
  status      VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  INT REFERENCES users(user_id),
  updated_by  INT REFERENCES users(user_id),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_config_brand_models
  ON asset_config_brand_models (brand_id, model_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_asset_config_brand_models_brand
  ON asset_config_brand_models (brand_id);

CREATE TABLE IF NOT EXISTS asset_config_brand_generations (
  id            SERIAL PRIMARY KEY,
  brand_id      INT NOT NULL REFERENCES asset_config_brands(id) ON DELETE CASCADE,
  generation_id INT NOT NULL REFERENCES asset_config_generations(id) ON DELETE CASCADE,
  status        VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    INT REFERENCES users(user_id),
  updated_by    INT REFERENCES users(user_id),
  deleted_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_config_brand_generations
  ON asset_config_brand_generations (brand_id, generation_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_asset_config_brand_generations_brand
  ON asset_config_brand_generations (brand_id);

-- Backfill model mappings from legacy brand_id before deduplicating global model names.
INSERT INTO asset_config_brand_models (brand_id, model_id, status)
SELECT m.brand_id, m.id, m.status
  FROM asset_config_models m
 WHERE m.deleted_at IS NULL AND m.brand_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM asset_config_brand_models bm
      WHERE bm.brand_id = m.brand_id AND bm.model_id = m.id AND bm.deleted_at IS NULL
   );

-- Merge duplicate model names (same name under different brands) into one global master.
WITH ranked AS (
  SELECT id, brand_id, name,
         MIN(id) OVER (PARTITION BY LOWER(TRIM(name))) AS keep_id
    FROM asset_config_models
   WHERE deleted_at IS NULL
),
dupes AS (
  SELECT id AS dupe_id, keep_id, brand_id
    FROM ranked
   WHERE id <> keep_id
)
INSERT INTO asset_config_brand_models (brand_id, model_id, status)
SELECT d.brand_id, d.keep_id, 'active'
  FROM dupes d
 WHERE d.brand_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM asset_config_brand_models bm
      WHERE bm.brand_id = d.brand_id AND bm.model_id = d.keep_id AND bm.deleted_at IS NULL
   );

UPDATE asset_config_brand_models bm
   SET deleted_at = NOW()
  FROM (
    SELECT id AS dupe_id, MIN(id) OVER (PARTITION BY LOWER(TRIM(name))) AS keep_id
      FROM asset_config_models
     WHERE deleted_at IS NULL
  ) d
 WHERE bm.model_id = d.dupe_id
   AND d.dupe_id <> d.keep_id
   AND bm.deleted_at IS NULL;

UPDATE asset_config_models m
   SET deleted_at = NOW()
  FROM (
    SELECT id,
           MIN(id) OVER (PARTITION BY LOWER(TRIM(name))) AS keep_id
      FROM asset_config_models
     WHERE deleted_at IS NULL
  ) d
 WHERE m.id = d.id
   AND d.id <> d.keep_id
   AND m.deleted_at IS NULL;

-- Models & generations become global masters (brand mapping via junction tables).
ALTER TABLE asset_config_models ALTER COLUMN brand_id DROP NOT NULL;
ALTER TABLE asset_config_generations ALTER COLUMN processor_id DROP NOT NULL;

DROP INDEX IF EXISTS uq_asset_config_models_brand_name;
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_config_models_name
  ON asset_config_models (LOWER(TRIM(name))) WHERE deleted_at IS NULL;

-- Dedupe generation names before global unique index.
WITH ranked AS (
  SELECT id,
         MIN(id) OVER (PARTITION BY LOWER(TRIM(name))) AS keep_id
    FROM asset_config_generations
   WHERE deleted_at IS NULL
)
UPDATE asset_config_generations g
   SET deleted_at = NOW()
  FROM ranked r
 WHERE g.id = r.id
   AND r.id <> r.keep_id
   AND g.deleted_at IS NULL;

DROP INDEX IF EXISTS uq_asset_config_generations_proc_name;
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_config_generations_name
  ON asset_config_generations (LOWER(TRIM(name))) WHERE deleted_at IS NULL;

-- Backfill generation mappings from legacy brand→processor→generation links.
INSERT INTO asset_config_brand_generations (brand_id, generation_id, status)
SELECT DISTINCT bp.brand_id, bpg.generation_id, bpg.status
  FROM asset_config_brand_processor_generations bpg
  JOIN asset_config_brand_processors bp ON bp.id = bpg.brand_processor_id AND bp.deleted_at IS NULL
 WHERE bpg.deleted_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM asset_config_brand_generations bg
      WHERE bg.brand_id = bp.brand_id AND bg.generation_id = bpg.generation_id AND bg.deleted_at IS NULL
   );
