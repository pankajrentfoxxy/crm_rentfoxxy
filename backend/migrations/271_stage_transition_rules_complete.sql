-- Part 5.3 (findings R1, R2, R3) — complete stage_transition_rules.
--
-- The table is the map, and the map has holes. Today that does not show,
-- because canBypassTransitionRules waves through admin, floor_manager, manager
-- and super_admin — which is every role that moves a ticket — so the rules are
-- consulted for nobody who matters.
--
-- Removing the bypass without filling the holes would stop the floor dead, so
-- this migration comes first. Every transition below is one the code already
-- performs today; this is a transcription of live behaviour into the table,
-- not a loosening or a redesign. Each row says which code path performs it.
--
-- The holes, for the record:
--   Diagnosis -> Floor Manager       diagnosisController, when checks fail
--   Diagnosis -> Procurement         diagnosisController, when parts are needed
--   Diagnosis -> Hold                diagnosisController, security hold
--   Chip Level Repair -> Diagnosis   chipLevelController.submitChipRepair
--   Body & Paint -> Diagnosis        same shape, re-inspection after body work
--   Final Testing -> Assembly        Part 5.4: Final Testing could only pass
--   Dispatch QC -> Assembly          moveToStage rework path; 082 tried to seed
--                                    this and the row is not in the live table
--   Hold -> Diagnosis / Floor Manager  release from hold, which nothing could do
--   Inventory -> Diagnosis / QC1     a completed ticket reopened

INSERT INTO stage_transition_rules (from_stage_name, to_stage_name, condition, is_backward, notes)
VALUES
  ('Diagnosis',          'Floor Manager',       'diagnosis_failed',    true,  'Diagnosis found failures — back to the floor manager'),
  ('Diagnosis',          'Procurement',         'parts_required',      false, 'Diagnosis needs parts before work can continue'),
  ('Diagnosis',          'Hold',                'security_hold',       false, 'Security hold raised at diagnosis'),
  ('Diagnosis',          'Dismantle',           'dismantle_required',  false, 'Unit is to be broken for parts'),

  ('Chip Level Repair',  'Diagnosis',           'repair_completed',    true,  'Chip repair done — re-diagnose before assembly'),
  ('Body & Paint',       'Diagnosis',           'repair_completed',    true,  'Body work done — re-diagnose before assembly'),

  ('Procurement',        'Assembly & Software', 'parts_fulfilled',     false, 'Parts issued — back into assembly'),
  ('Procurement',        'Diagnosis',           'parts_unavailable',   true,  'Parts cannot be sourced — back to diagnosis'),

  ('Final Testing',      'Assembly & Software', 'final_test_failed',   true,  'Part 5.4: Final Testing had no failure route at all'),

  ('Dispatch QC',        'Assembly & Software', 'dispatch_qc_failed',  true,  'Dispatch QC failed — rework, laptop stays on the SO'),

  ('Hold',               'Diagnosis',           'hold_released',       true,  'Security hold cleared — resume diagnosis'),
  ('Hold',               'Floor Manager',       'hold_released',       true,  'Security hold cleared — back to the floor manager'),

  ('Inventory',          'Diagnosis',           'reopened',            true,  'Completed ticket reopened for rework'),
  ('Inventory',          'QC1',                 'reopened',            true,  'Completed ticket sent back through QC'),

  ('Dismantle',          'Inventory',           'dismantled',          false, 'Unit broken for parts — ticket closes'),

  -- Part 5.4 (R6): the third failure stops going round the loop and goes to the
  -- floor manager. Without these rows the escalation has nowhere to land.
  ('QC1',                'Floor Manager',       'qc_escalated',        true,  'Third QC failure — escalated off the rework loop'),
  ('QC2',                'Floor Manager',       'qc_escalated',        true,  'Third QC failure — escalated off the rework loop'),
  ('Dispatch QC',        'Floor Manager',       'qc_escalated',        true,  'Third QC failure — escalated off the rework loop'),
  ('Final Testing',      'Floor Manager',       'qc_escalated',        true,  'Third failure — escalated off the rework loop')
ON CONFLICT (from_stage_name, to_stage_name) DO NOTHING;

-- Re-entry into production from outside the floor. Two paths do this today:
-- vendorRepairDcService, when a unit comes back from a vendor repair, and
-- qcProcessIntakeService, when a unit is reopened from QC Process. Both land the
-- ticket on the floor manager's desk for triage, from wherever it was.
--
-- These are enumerated rather than waved through with a flag. An exemption that
-- says "this code path may ignore the map" is how canBypassTransitionRules
-- started, and the map stops meaning anything the moment one exists.
INSERT INTO stage_transition_rules (from_stage_name, to_stage_name, condition, is_backward, notes)
SELECT s.stage_name, 'Floor Manager', 'reentry', true,
       'Re-entry from outside the floor (vendor repair return, QC Process reopen)'
  FROM stages s
 WHERE s.stage_name <> 'Floor Manager'
ON CONFLICT (from_stage_name, to_stage_name) DO NOTHING;
