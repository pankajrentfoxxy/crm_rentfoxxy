-- Ticket category: primary workflow type at creation (complaint | pickup | replacement)
BEGIN;

ALTER TABLE support_tickets
    ADD COLUMN IF NOT EXISTS ticket_category VARCHAR(20);

UPDATE support_tickets t
SET ticket_category = sub.item_type
FROM (
    SELECT DISTINCT ON (ticket_id) ticket_id, item_type
    FROM support_ticket_items
    ORDER BY ticket_id, id ASC
) sub
WHERE t.id = sub.ticket_id AND (t.ticket_category IS NULL OR t.ticket_category = '');

ALTER TABLE support_tickets
    ALTER COLUMN ticket_category SET DEFAULT 'complaint';

COMMIT;
