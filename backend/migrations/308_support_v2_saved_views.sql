-- ============================================================
-- Migration 204: Support revamp — saved queue views
--   Number is 204 (not 199) because 199–203 already exist.
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS support_saved_views (
  view_id     SERIAL PRIMARY KEY,
  name        VARCHAR(60) NOT NULL,
  slug        VARCHAR(60) NOT NULL,
  owner_id    INT REFERENCES users(user_id),
  is_system   BOOLEAN NOT NULL DEFAULT FALSE,
  filters     JSONB NOT NULL DEFAULT '{}',
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_views_owner_slug
  ON support_saved_views (owner_id, slug)
  WHERE owner_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_views_system_slug
  ON support_saved_views (slug)
  WHERE is_system = TRUE;

INSERT INTO support_saved_views (name, slug, owner_id, is_system, filters, sort_order) VALUES
  ('All open',           'all_open',           NULL, TRUE, '{"status":"OPEN"}', 10),
  ('Breaching',          'breaching',          NULL, TRUE, '{"status":"OPEN","sla":"BREACHED_OR_AT_RISK"}', 20),
  ('Unassigned',         'unassigned',         NULL, TRUE, '{"status":"OPEN","assigned_to":"NONE"}', 30),
  ('Mine',               'mine',               NULL, TRUE, '{"status":"OPEN","assigned_to":"ME"}', 40),
  ('Pending customer',   'pending_customer',   NULL, TRUE, '{"status":"PENDING","pending_reason":"PENDING_CUSTOMER"}', 50),
  ('Field jobs today',   'field_jobs_today',   NULL, TRUE, '{"has_wo_today":true}', 60),
  ('Resolved · 7 days',  'resolved_7d',        NULL, TRUE, '{"status":"RESOLVED","resolved_within_days":7}', 70)
ON CONFLICT DO NOTHING;
