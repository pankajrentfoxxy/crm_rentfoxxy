-- ============================================================
-- Migration 205: Support revamp — ticket links, reopen, line extras
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS support_ticket_links (
  link_id          SERIAL PRIMARY KEY,
  from_ticket_id   INT NOT NULL REFERENCES support_tickets_v2(ticket_id) ON DELETE CASCADE,
  to_ticket_id     INT NOT NULL REFERENCES support_tickets_v2(ticket_id) ON DELETE CASCADE,
  link_type        VARCHAR(20) NOT NULL
                     CHECK (link_type IN ('REPEAT_OF','RELATED','MERGED','DUPLICATE')),
  created_by       INT REFERENCES users(user_id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (from_ticket_id, to_ticket_id, link_type)
);
CREATE INDEX IF NOT EXISTS idx_stk2_links_to ON support_ticket_links(to_ticket_id);

ALTER TABLE support_tickets_v2
  ADD COLUMN IF NOT EXISTS reopen_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reopen_reason TEXT;

ALTER TABLE support_ticket_assets
  ADD COLUMN IF NOT EXISTS time_spent_minutes INT;

ALTER TABLE support_ticket_events
  ADD COLUMN IF NOT EXISTS contact_method VARCHAR(20);
