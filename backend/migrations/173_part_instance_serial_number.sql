-- Migration 173 — physical serial numbers for individual part units.
--
-- Each part unit already gets a system PRT-ID (part_instances.prt_id). This adds
-- an optional, user-entered physical/manufacturer serial number so warehouse staff
-- can identify exactly which unit was added and which unit gets attached on approval.

ALTER TABLE part_instances ADD COLUMN IF NOT EXISTS serial_number VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_part_instances_serial
  ON part_instances (serial_number);

-- Speeds up "available units for this part" lookups used by the approval popups.
CREATE INDEX IF NOT EXISTS idx_part_instances_part_status
  ON part_instances (part_id, status);
