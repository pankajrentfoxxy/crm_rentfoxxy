-- ============================================================
-- Migration 099: Support Part Reassignment (move part to another ticket)
--   A technician holding a part for ticket A (issued, not yet used) can
--   request to move it to another of their tickets (B). Warehouse approves,
--   which re-points the request to the new ticket / machine.
-- Idempotent: safe to re-run.
-- ============================================================

ALTER TABLE support_part_requests
  ADD COLUMN IF NOT EXISTS reassign_to_ticket_id  INT REFERENCES support_tickets(id),
  ADD COLUMN IF NOT EXISTS reassign_to_item_id    INT REFERENCES support_ticket_items(id),
  ADD COLUMN IF NOT EXISTS reassign_to_ttspl_id   VARCHAR(120),
  ADD COLUMN IF NOT EXISTS reassign_to_serial     VARCHAR(255),
  ADD COLUMN IF NOT EXISTS reassign_reason        TEXT,
  ADD COLUMN IF NOT EXISTS reassign_requested_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reassign_requested_by  INT REFERENCES users(user_id);

CREATE INDEX IF NOT EXISTS idx_spr_reassign_pending
  ON support_part_requests(reassign_requested_at)
  WHERE reassign_requested_at IS NOT NULL;
