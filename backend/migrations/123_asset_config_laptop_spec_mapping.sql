-- Laptop spec mapping: Brand → Processor → Generation (independent from spare parts)

CREATE TABLE IF NOT EXISTS asset_config_brand_processors (
  id            SERIAL PRIMARY KEY,
  brand_id      INT NOT NULL REFERENCES asset_config_brands(id) ON DELETE CASCADE,
  processor_id  INT NOT NULL REFERENCES asset_config_processors(id) ON DELETE CASCADE,
  status        VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by    INT REFERENCES users(user_id),
  updated_by    INT REFERENCES users(user_id),
  deleted_at    TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_config_brand_processors
  ON asset_config_brand_processors (brand_id, processor_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_asset_config_brand_processors_brand
  ON asset_config_brand_processors (brand_id);

CREATE TABLE IF NOT EXISTS asset_config_brand_processor_generations (
  id                  SERIAL PRIMARY KEY,
  brand_processor_id  INT NOT NULL REFERENCES asset_config_brand_processors(id) ON DELETE CASCADE,
  generation_id       INT NOT NULL REFERENCES asset_config_generations(id) ON DELETE CASCADE,
  status              VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by          INT REFERENCES users(user_id),
  updated_by          INT REFERENCES users(user_id),
  deleted_at          TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_config_brand_processor_generations
  ON asset_config_brand_processor_generations (brand_processor_id, generation_id) WHERE deleted_at IS NULL;
