-- Allow field technicians to register old/damaged parts collected when marking
-- a support spare as used. Code inserts source = 'support_old_part_return'.

ALTER TABLE part_instances DROP CONSTRAINT IF EXISTS part_instances_source_check;
ALTER TABLE part_instances
  ADD CONSTRAINT part_instances_source_check
  CHECK (source IN (
    'purchase',
    'defective_return',
    'manual',
    'legacy',
    'support_old_part_return'
  ));
