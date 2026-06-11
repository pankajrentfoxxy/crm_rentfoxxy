CREATE TABLE IF NOT EXISTS lead_auto_assign_config (
  id                SERIAL PRIMARY KEY,
  user_ids          INT[] NOT NULL DEFAULT '{}',
  round_robin_index INT NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_by        INT REFERENCES users(user_id)
);
