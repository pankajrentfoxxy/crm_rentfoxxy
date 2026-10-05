-- 259_support_ticket_contact_name.sql
-- The person who raised the complaint / pickup (e.g. "Shahnwaz Khan" at SPNN).
-- support_tickets.customer_name holds the company, so the requester's own name
-- was lost when a QR / portal request was converted into a ticket.

ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS ticket_contact_name VARCHAR(150);

-- Backfill converted requests. QR requests carry the person in customer_name;
-- portal requests carry the company there, so prefer the address contact name.
UPDATE support_tickets t
   SET ticket_contact_name = LEFT(src.contact_name, 150)
  FROM (
    SELECT DISTINCT ON (sr.ticket_id)
           sr.ticket_id,
           NULLIF(TRIM(CASE
             WHEN sr.source = 'portal' THEN COALESCE(
               NULLIF(TRIM(sr.extra->'pickup_address'->>'name'), ''),
               NULLIF(TRIM(sr.extra->'service_address'->>'name'), ''))
             ELSE COALESCE(
               NULLIF(TRIM(sr.customer_name), ''),
               NULLIF(TRIM(sr.extra->'pickup_address'->>'name'), ''),
               NULLIF(TRIM(sr.extra->'service_address'->>'name'), ''))
           END), '') AS contact_name
      FROM support_requests sr
     WHERE sr.ticket_id IS NOT NULL
     ORDER BY sr.ticket_id, sr.id DESC
  ) src
 WHERE src.ticket_id = t.id
   AND src.contact_name IS NOT NULL
   AND t.ticket_contact_name IS NULL;
