-- Preferred technician visit time from public complaint requests.

ALTER TABLE support_ticket_items
  ADD COLUMN IF NOT EXISTS visit_scheduled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_support_ticket_items_visit_scheduled
  ON support_ticket_items (visit_scheduled_at)
  WHERE visit_scheduled_at IS NOT NULL;
