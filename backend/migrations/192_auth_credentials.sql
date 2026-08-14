-- Unified login credentials (CRM / vendor / customer).
-- Login uses email + password only; portal type is returned in the response.

CREATE TABLE IF NOT EXISTS auth_credentials (
  id              SERIAL PRIMARY KEY,
  email           TEXT NOT NULL,
  email_lower     TEXT GENERATED ALWAYS AS (LOWER(TRIM(email))) STORED,
  password_hash   TEXT NOT NULL,
  portal          TEXT NOT NULL CHECK (portal IN ('crm', 'vendor', 'customer')),
  entity_id       INTEGER NOT NULL,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT auth_credentials_email_lower_unique UNIQUE (email_lower)
);

CREATE INDEX IF NOT EXISTS idx_auth_credentials_portal_entity
  ON auth_credentials (portal, entity_id);

COMMENT ON TABLE auth_credentials IS
  'Single login table for CRM users, vendors, and customers. One email → one portal.';

-- Clear and rebuild so re-runs are safe
TRUNCATE auth_credentials RESTART IDENTITY;

-- Backfill: customer → vendor → crm (later inserts win on same email)
-- DISTINCT ON avoids ON CONFLICT hitting the same email twice in one statement

INSERT INTO auth_credentials (email, password_hash, portal, entity_id, enabled)
SELECT DISTINCT ON (LOWER(TRIM(c.email)))
       c.email, c.portal_password_hash, 'customer', c.customer_id, COALESCE(c.portal_enabled, false)
FROM customers c
WHERE c.email IS NOT NULL
  AND TRIM(c.email) <> ''
  AND c.portal_password_hash IS NOT NULL
ORDER BY LOWER(TRIM(c.email)), c.customer_id DESC
ON CONFLICT (email_lower) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  portal = EXCLUDED.portal,
  entity_id = EXCLUDED.entity_id,
  enabled = EXCLUDED.enabled,
  updated_at = NOW();

INSERT INTO auth_credentials (email, password_hash, portal, entity_id, enabled)
SELECT DISTINCT ON (LOWER(TRIM(v.email)))
       v.email,
       COALESCE(v.vendor_portal_password_hash, v.password_hash),
       'vendor',
       v.vendor_id,
       (v.deleted_at IS NULL AND COALESCE(v.vendor_portal_enabled, true) AND v.status = 'approved')
FROM vendors v
WHERE v.email IS NOT NULL
  AND TRIM(v.email) <> ''
  AND COALESCE(v.vendor_portal_password_hash, v.password_hash) IS NOT NULL
  AND v.deleted_at IS NULL
ORDER BY LOWER(TRIM(v.email)), v.vendor_id DESC
ON CONFLICT (email_lower) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  portal = EXCLUDED.portal,
  entity_id = EXCLUDED.entity_id,
  enabled = EXCLUDED.enabled,
  updated_at = NOW();

INSERT INTO auth_credentials (email, password_hash, portal, entity_id, enabled)
SELECT DISTINCT ON (LOWER(TRIM(u.email)))
       u.email, u.password_hash, 'crm', u.user_id, COALESCE(u.active, false)
FROM users u
WHERE u.email IS NOT NULL
  AND TRIM(u.email) <> ''
  AND u.password_hash IS NOT NULL
ORDER BY LOWER(TRIM(u.email)), u.user_id DESC
ON CONFLICT (email_lower) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  portal = EXCLUDED.portal,
  entity_id = EXCLUDED.entity_id,
  enabled = EXCLUDED.enabled,
  updated_at = NOW();
