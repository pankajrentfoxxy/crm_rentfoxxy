-- ============================================================
-- Migration 082: Add Dispatch QC stage and team
-- Only used for sales_order_qc tickets
-- ============================================================

INSERT INTO teams (team_name)
SELECT 'Dispatch QC Team'
WHERE NOT EXISTS (SELECT 1 FROM teams WHERE team_name = 'Dispatch QC Team');

INSERT INTO stages (stage_name, stage_order, stage_category, team_id, description)
SELECT 'Dispatch QC', 10,
  'QC Team',
  (SELECT team_id FROM teams WHERE team_name = 'Dispatch QC Team' LIMIT 1),
  'Final QC before Sales Order dispatch. Only for sales_order_qc tickets.'
WHERE NOT EXISTS (SELECT 1 FROM stages WHERE stage_name = 'Dispatch QC');

CREATE TABLE IF NOT EXISTS qc_round_robin_state (
    team_id INTEGER PRIMARY KEY,
    last_assigned_user_id INTEGER,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO stage_transition_rules (from_stage_name, to_stage_name, condition, is_backward, notes)
VALUES
  ('QC1',          'Dispatch QC',           'qc1_passed_so',      false, 'QC1 passed — sales_order_qc goes to Dispatch QC'),
  ('Dispatch QC',  'Inventory',             'dispatch_qc_passed',   false, 'Dispatch QC passed — DC can be generated'),
  ('Dispatch QC',  'Assembly & Software',   'dispatch_qc_failed', true,  'Dispatch QC failed — back to tech')
ON CONFLICT (from_stage_name, to_stage_name) DO NOTHING;

INSERT INTO qc_round_robin_state (team_id, last_assigned_user_id)
SELECT t.team_id, NULL
FROM teams t WHERE t.team_name = 'Dispatch QC Team'
ON CONFLICT (team_id) DO NOTHING;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('qc', 'floor_pipeline', true, false, true, false),
  ('qc', 'floor_tickets',  true, false, true, false)
ON CONFLICT (role, section) DO NOTHING;
