-- Super-admin "open customer portal" support.
--
-- Impersonated portal sessions are ordinary customer_portal_sessions rows tagged
-- with the CRM user who created them. The tag drives two things at runtime: a
-- banner in the portal, and a block on any write performed while impersonating.
-- Every hand-off is also appended to an immutable log, since sessions are
-- deleted on logout and would otherwise leave no trace.

ALTER TABLE customer_portal_sessions
  ADD COLUMN IF NOT EXISTS impersonated_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_cps_impersonated_by
  ON customer_portal_sessions (impersonated_by)
  WHERE impersonated_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS customer_portal_impersonation_log (
  id            SERIAL PRIMARY KEY,
  customer_id   INTEGER NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
  actor_user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  actor_email   VARCHAR(320),
  actor_role    VARCHAR(50),
  ip_address    VARCHAR(64),
  user_agent    TEXT,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cpil_customer
  ON customer_portal_impersonation_log (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cpil_actor
  ON customer_portal_impersonation_log (actor_user_id, created_at DESC);
