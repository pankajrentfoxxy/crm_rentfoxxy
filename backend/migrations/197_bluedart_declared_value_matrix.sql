-- BlueDart AWB declared-value matrix (editable; not hardcoded in app).
CREATE TABLE IF NOT EXISTS bluedart_declared_value_matrix (
  id            SERIAL PRIMARY KEY,
  category      VARCHAR(40) NOT NULL,
  grade         VARCHAR(40) NOT NULL,
  amount        NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  label         VARCHAR(120),
  sort_order    INT NOT NULL DEFAULT 0,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bluedart_declared_value_matrix_cat_grade_uq UNIQUE (category, grade)
);

CREATE INDEX IF NOT EXISTS idx_bluedart_declared_value_active
  ON bluedart_declared_value_matrix (active, category, grade);

-- Seed current production matrix (idempotent).
INSERT INTO bluedart_declared_value_matrix (category, grade, amount, label, sort_order) VALUES
  ('i5', '5th', 14000, 'i5 · 5th', 10),
  ('i5', '6th', 16000, 'i5 · 6th', 20),
  ('i5', '7th', 18000, 'i5 · 7th', 30),
  ('i5', '8th', 20000, 'i5 · 8th', 40),
  ('i5', '10th', 22000, 'i5 · 10th', 50),
  ('i5', '11th', 25000, 'i5 · 11th', 60),
  ('i5', '12th', 35000, 'i5 · 12th', 70),
  ('i5', '13th', 40000, 'i5 · 13th', 80),
  ('i5', '14th', 45000, 'i5 · 14th', 90),
  ('i7', '4th', 14000, 'i7 · 4th', 100),
  ('i7', '5th', 15000, 'i7 · 5th', 110),
  ('i7', '6th', 18000, 'i7 · 6th', 120),
  ('i7', '7th', 19000, 'i7 · 7th', 130),
  ('i7', '8th', 22000, 'i7 · 8th', 140),
  ('i7', '10th', 24000, 'i7 · 10th', 150),
  ('i7', '11th', 28000, 'i7 · 11th', 160),
  ('i7', '12th', 35000, 'i7 · 12th', 170),
  ('i7', '13th', 40000, 'i7 · 13th', 180),
  ('i7', '14th', 45000, 'i7 · 14th', 190),
  ('i7', 'u7', 50000, 'i7 · U7', 200),
  ('R7', 'ALL', 60000, 'Ryzen 7 · ALL', 210),
  ('APPLE', 'm1-air', 60000, 'MacBook M1 Air', 220),
  ('APPLE', 'm1-pro', 70000, 'MacBook M1 Pro', 230),
  ('APPLE', 'm2-pro', 80000, 'MacBook M2 Pro', 240),
  ('APPLE', 'm3', 100000, 'MacBook M3', 250),
  ('APPLE', 'm4', 190000, 'MacBook M4', 260),
  ('APPLE', 'm5', 230000, 'MacBook M5', 270)
ON CONFLICT (category, grade) DO NOTHING;
