-- 441: Check in again, and a visit's second place (17 Oct 2026).
--
-- Field day: a technician who checked out (by mistake, or the 10 PM auto
-- check-out) checks in again, or a lead does it for them; the check-out leg
-- is dropped so the next stop is measured from the last real stop. A lead
-- can also check a technician in who never started.
-- Visit place: Support changes where a complaint visit happens. Before the
-- technician has reached, the address simply changes; once reached it can
-- only become place 2 — the stop at place 1 stays, and the technician marks
-- reached again at place 2 (measured from place 1). Additive only.

ALTER TABLE field_days ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ;
ALTER TABLE field_days ADD COLUMN IF NOT EXISTS reopened_by INT;
ALTER TABLE field_days ADD COLUMN IF NOT EXISTS reopen_count INT NOT NULL DEFAULT 0;
ALTER TABLE field_days ADD COLUMN IF NOT EXISTS started_by INT;

ALTER TABLE support_ticket_items ADD COLUMN IF NOT EXISTS visit_address TEXT;
ALTER TABLE support_ticket_items ADD COLUMN IF NOT EXISTS visit_place_no SMALLINT NOT NULL DEFAULT 1;
ALTER TABLE support_ticket_items ADD COLUMN IF NOT EXISTS visit_moved_at TIMESTAMPTZ;
ALTER TABLE support_ticket_items ADD COLUMN IF NOT EXISTS visit_moved_by INT;
