-- Spare Part Model master + Brand → Model mapping (mirrors laptop flat mapping).
-- Independent from laptop asset_config_models / asset_config_brand_models.

CREATE TABLE IF NOT EXISTS asset_config_spare_models (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  status      VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  INT REFERENCES users(user_id),
  updated_by  INT REFERENCES users(user_id),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_config_spare_models_name
  ON asset_config_spare_models (LOWER(TRIM(name))) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS asset_config_spare_brand_models (
  id          SERIAL PRIMARY KEY,
  brand_id    INT NOT NULL REFERENCES asset_config_spare_brands(id) ON DELETE CASCADE,
  model_id    INT NOT NULL REFERENCES asset_config_spare_models(id) ON DELETE CASCADE,
  status      VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by  INT REFERENCES users(user_id),
  updated_by  INT REFERENCES users(user_id),
  deleted_at  TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_config_spare_brand_models
  ON asset_config_spare_brand_models (brand_id, model_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_asset_config_spare_brand_models_brand
  ON asset_config_spare_brand_models (brand_id) WHERE deleted_at IS NULL;

-- Catalog default model (nullable for legacy rows).
ALTER TABLE vendor_spare_parts_catalog
  ADD COLUMN IF NOT EXISTS default_model VARCHAR(120);

-- Floor parts: denormalized default brand/model for listing (nullable).
ALTER TABLE parts
  ADD COLUMN IF NOT EXISTS default_brand VARCHAR(120),
  ADD COLUMN IF NOT EXISTS default_model VARCHAR(120);
