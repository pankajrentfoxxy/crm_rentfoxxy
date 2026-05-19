-- Allow multiple ticket rows per serial over time (e.g. first repair completed, later repair).
-- Enforce at most one non-terminal ticket per serial (in_progress / on_hold).

ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_serial_number_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tickets_serial_open
ON tickets (serial_number)
WHERE status IN ('in_progress', 'on_hold');
