-- Backfill tickets.ttspl_id from machine_number when refurb source stored TTSPL there (ttspl_id was NULL).
UPDATE tickets
SET ttspl_id = UPPER((regexp_match(machine_number, 'TTSPL[0-9]+', 'i'))[1])
WHERE (ttspl_id IS NULL OR TRIM(ttspl_id) = '')
  AND machine_number ~* 'TTSPL[0-9]+';

SELECT
  COUNT(*)::int AS total,
  COUNT(*) FILTER (WHERE ttspl_id IS NOT NULL AND TRIM(ttspl_id) <> '')::int AS with_ttspl
FROM tickets;
