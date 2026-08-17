-- Persist typed/login signer names on Return DC e-sign (PDF Name: line).
ALTER TABLE support_ticket_items
  ADD COLUMN IF NOT EXISTS technician_esign_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS warehouse_esign_name VARCHAR(255);

-- Backfill from users when signature already exists but name was never stored.
UPDATE support_ticket_items sti
   SET technician_esign_name = COALESCE(
         NULLIF(TRIM(sti.technician_esign_name), ''),
         NULLIF(TRIM(u.name), ''),
         NULLIF(TRIM(u.email), '')
       )
  FROM users u
 WHERE sti.technician_esign_by = u.user_id
   AND sti.technician_esign_url IS NOT NULL
   AND COALESCE(NULLIF(TRIM(sti.technician_esign_name), ''), '') = '';

UPDATE support_ticket_items sti
   SET warehouse_esign_name = COALESCE(
         NULLIF(TRIM(sti.warehouse_esign_name), ''),
         NULLIF(TRIM(u.name), ''),
         NULLIF(TRIM(u.email), '')
       )
  FROM users u
 WHERE COALESCE(sti.warehouse_esign_by, sti.warehouse_received_by) = u.user_id
   AND (sti.warehouse_esign_url IS NOT NULL OR sti.warehouse_received_at IS NOT NULL)
   AND COALESCE(NULLIF(TRIM(sti.warehouse_esign_name), ''), '') = '';
