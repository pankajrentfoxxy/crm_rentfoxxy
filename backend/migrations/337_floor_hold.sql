-- Production, PD11: a ticket can be put on Hold from any floor stage, with a
-- reason, and released back to where it was, with a reason. Today Hold is
-- reachable only as a Diagnosis security hold that nothing triggers, and
-- nothing releases it (F6).
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS hold_from_stage_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS held_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS held_by INT REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hold_reason TEXT;

INSERT INTO stage_transition_rules (from_stage_name, to_stage_name, condition, is_backward, notes)
SELECT s.name, 'Hold', 'hold', FALSE, 'PD11: put on hold with a reason'
  FROM unnest(ARRAY['Floor Manager', 'Diagnosis', 'Chip Level Repair', 'Dismantle', 'Procurement', 'Body & Paint',
                    'Assembly & Software', 'Final Testing', 'QC1', 'QC2', 'Pending Inventory']) AS s(name)
 WHERE NOT EXISTS (SELECT 1 FROM stage_transition_rules r WHERE r.from_stage_name = s.name AND r.to_stage_name = 'Hold');

INSERT INTO stage_transition_rules (from_stage_name, to_stage_name, condition, is_backward, notes)
SELECT 'Hold', s.name, 'hold_released', FALSE, 'PD11: released back to the stage it was held at'
  FROM unnest(ARRAY['Floor Manager', 'Diagnosis', 'Chip Level Repair', 'Dismantle', 'Procurement', 'Body & Paint',
                    'Assembly & Software', 'Final Testing', 'QC1', 'QC2', 'Pending Inventory']) AS s(name)
 WHERE NOT EXISTS (SELECT 1 FROM stage_transition_rules r WHERE r.from_stage_name = 'Hold' AND r.to_stage_name = s.name);
