-- ============================================================
-- Migration 089: GRN Access Numbers
--   Short numeric codes that map to a GRN capture URL. The access
--   number itself is the authentication key (no separate password).
-- ============================================================

-- Sequence backing the human-friendly numeric codes (e.g. 17, 18, 19 …).
CREATE SEQUENCE IF NOT EXISTS grn_access_number_seq START 17 INCREMENT 1;

CREATE TABLE IF NOT EXISTS grn_access_numbers (
  id             SERIAL PRIMARY KEY,
  access_number  INTEGER NOT NULL UNIQUE,
  capture_url    TEXT NOT NULL,
  capture_token  UUID,
  po_id          INTEGER,
  status         VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'used', 'expired')),
  created_by     INTEGER REFERENCES users(user_id),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  used_at        TIMESTAMPTZ,
  expires_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_grn_access_status ON grn_access_numbers(status);
CREATE INDEX IF NOT EXISTS idx_grn_access_token  ON grn_access_numbers(capture_token);

-- Audit log of every access attempt against the public /access page.
CREATE TABLE IF NOT EXISTS grn_access_attempts (
  id             SERIAL PRIMARY KEY,
  access_number  INTEGER,
  access_id      INTEGER REFERENCES grn_access_numbers(id) ON DELETE SET NULL,
  success        BOOLEAN NOT NULL DEFAULT FALSE,
  result         VARCHAR(40),          -- 'ok' | 'invalid' | 'used' | 'expired'
  ip             VARCHAR(64),
  user_agent     TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grn_access_attempts_created ON grn_access_attempts(created_at DESC);
