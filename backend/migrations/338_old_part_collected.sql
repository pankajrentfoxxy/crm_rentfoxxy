-- Production, PD8: the technician records the part that came off at fitting;
-- the warehouse confirms it physically received it later, from a "to collect"
-- list — the ticket is not held up waiting for that. "Returned" used to be a
-- checkbox nobody verified.
ALTER TABLE part_instances
  ADD COLUMN IF NOT EXISTS collected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS collected_by INT REFERENCES users(user_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_part_instances_to_collect
  ON part_instances (removed_at) WHERE source = 'defective_return' AND collected_at IS NULL;
