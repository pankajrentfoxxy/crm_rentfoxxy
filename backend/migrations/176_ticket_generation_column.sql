-- Add CPU generation to tickets so the floor tickets list can display it and
-- config edits mirror onto the ticket row (like brand/model/processor/ram/storage).
-- Additive / idempotent. GRN accepted snapshot (grn_config / vendor serial) is NOT touched.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS generation VARCHAR(50);

-- Backfill from the working production asset config first.
UPDATE tickets t
SET generation = pa.generation
FROM production_assets pa
WHERE pa.ticket_id = t.ticket_id
  AND NULLIF(TRIM(t.generation), '') IS NULL
  AND NULLIF(TRIM(pa.generation), '') IS NOT NULL;

-- Fallback to inventory (by serial or TTSPL/machine number) for tickets not covered above.
UPDATE tickets t
SET generation = i.generation
FROM inventory i
WHERE NULLIF(TRIM(t.generation), '') IS NULL
  AND NULLIF(TRIM(i.generation), '') IS NOT NULL
  AND (LOWER(i.serial_number) = LOWER(t.serial_number) OR i.machine_number = t.ttspl_id);
