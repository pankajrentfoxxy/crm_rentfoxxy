-- Part 5.1 — make GRN configuration verification readable and attributable.
--
-- grn_config_verifications has been written on every capture since migration 092
-- and read by nothing. It is keyed by token_id, and the received serial kept no
-- reference to the token that verified it, so there was no path from a unit on
-- the GRN screen back to its verification. These columns are that path.
--
-- config_capture_waived records the other half honestly: a 'not_on' unit cannot
-- run the capture script, so it is received manually. That skip used to be
-- invisible. Now it carries a reason and an actor.

ALTER TABLE vendor_serial_numbers
  ADD COLUMN IF NOT EXISTS capture_token_id            UUID,
  ADD COLUMN IF NOT EXISTS config_capture_waived       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS config_capture_waiver_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_vsn_capture_token
  ON vendor_serial_numbers (capture_token_id)
  WHERE capture_token_id IS NOT NULL;

-- Backfill the link for units already received through a capture link.
-- A token carries the serial it captured, so (po_id, serial_number) is an exact
-- match. Ambiguous matches (the same serial captured twice on one PO) are left
-- NULL rather than guessed.
WITH one_token AS (
  SELECT po_id, UPPER(TRIM(serial_number)) AS sn, MIN(token_id::text)::uuid AS token_id
    FROM grn_serial_capture_tokens
   WHERE serial_number IS NOT NULL
     AND status IN ('captured', 'used')
   GROUP BY po_id, UPPER(TRIM(serial_number))
  HAVING COUNT(*) = 1
)
UPDATE vendor_serial_numbers v
   SET capture_token_id = t.token_id
  FROM one_token t
 WHERE v.capture_token_id IS NULL
   AND v.po_id = t.po_id
   AND UPPER(TRIM(v.serial_number)) = t.sn;
