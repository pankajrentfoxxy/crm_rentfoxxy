-- Lead laptop specs: align with Sales Order / asset configuration fields
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS model_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS gpu VARCHAR(100),
  ADD COLUMN IF NOT EXISTS screen_size VARCHAR(50);
