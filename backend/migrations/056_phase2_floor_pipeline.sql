-- Phase 2: Floor pipeline enhancements, TTSPL audit trail,
-- config history, stage rules, parts tracking enhancements

-- 1. Add missing columns to tickets table
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS ticket_type VARCHAR(50) DEFAULT 'grn_qc',
  ADD COLUMN IF NOT EXISTS qc_fail_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qc1_failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qc2_failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qc1_fail_reason TEXT,
  ADD COLUMN IF NOT EXISTS qc2_fail_reason TEXT,
  ADD COLUMN IF NOT EXISTS qc1_passed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qc2_passed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS body_paint_required BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS chip_repair_required BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS highlighted BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS highlighted_reason TEXT,
  ADD COLUMN IF NOT EXISTS floor_manager_qc_failed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS floor_manager_qc_failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS floor_manager_qc_fail_reason TEXT,
  ADD COLUMN IF NOT EXISTS return_to_vendor_dc_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS sales_order_id INT,
  ADD COLUMN IF NOT EXISTS sales_order_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tickets_ticket_type_check'
  ) THEN
    ALTER TABLE tickets
      ADD CONSTRAINT tickets_ticket_type_check
      CHECK (ticket_type IN ('grn_qc', 'sales_order_qc', 'support', 'general'));
  END IF;
END $$;

-- 2. TTSPL config history (every config change logged)
CREATE TABLE IF NOT EXISTS ttspl_config_history (
  history_id SERIAL PRIMARY KEY,
  ttspl_id VARCHAR(50) NOT NULL,
  vendor_serial_id INT REFERENCES vendor_serial_numbers(serial_id),
  ticket_id INT REFERENCES tickets(ticket_id),
  changed_by INT REFERENCES users(user_id),
  change_type VARCHAR(50) NOT NULL
    CHECK (change_type IN ('upgrade', 'replacement', 'correction', 'initial')),
  field_name VARCHAR(50) NOT NULL,
  old_value TEXT,
  new_value TEXT,
  notes TEXT,
  part_used_id INT,
  part_cost NUMERIC(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ttspl_config_history_ttspl
  ON ttspl_config_history (ttspl_id);
CREATE INDEX IF NOT EXISTS idx_ttspl_config_history_ticket
  ON ttspl_config_history (ticket_id);

-- 3. TTSPL master audit log (full lifecycle events per laptop)
CREATE TABLE IF NOT EXISTS ttspl_audit_log (
  log_id SERIAL PRIMARY KEY,
  ttspl_id VARCHAR(50) NOT NULL,
  vendor_serial_id INT REFERENCES vendor_serial_numbers(serial_id),
  event_type VARCHAR(80) NOT NULL,
  description TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  actor_user_id INT REFERENCES users(user_id),
  actor_name VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ttspl_audit_ttspl ON ttspl_audit_log (ttspl_id);
CREATE INDEX IF NOT EXISTS idx_ttspl_audit_created ON ttspl_audit_log (created_at DESC);

-- 4. Stage transition rules (enforced in backend)
CREATE TABLE IF NOT EXISTS stage_transition_rules (
  rule_id SERIAL PRIMARY KEY,
  from_stage_name VARCHAR(100) NOT NULL,
  to_stage_name VARCHAR(100) NOT NULL,
  condition VARCHAR(100),
  is_backward BOOLEAN DEFAULT FALSE,
  notes TEXT,
  UNIQUE(from_stage_name, to_stage_name)
);

INSERT INTO stage_transition_rules
  (from_stage_name, to_stage_name, condition, is_backward, notes)
VALUES
  ('Floor Manager',        'Diagnosis',             NULL,            FALSE, 'Auto on assign'),
  ('Diagnosis',            'Assembly & Software',   'no_chip_no_body',FALSE,'Normal flow'),
  ('Diagnosis',            'Chip Level Repair',     'chip_required', FALSE, 'Chip issue found'),
  ('Diagnosis',            'Body & Paint',          'body_required', FALSE, 'Body issue only'),
  ('Chip Level Repair',    'Assembly & Software',   NULL,            FALSE, 'After chip repair'),
  ('Body & Paint',         'Assembly & Software',   NULL,            FALSE, 'After body work'),
  ('Assembly & Software',  'Final Testing',         NULL,            FALSE, 'Normal flow'),
  ('Final Testing',        'QC1',                   NULL,            FALSE, 'Normal flow'),
  ('QC1',                  'QC2',                   'qc1_passed',    FALSE, 'QC1 passed'),
  ('QC1',                  'Assembly & Software',   'qc1_failed',    TRUE,  'QC1 failed — back to tech'),
  ('QC2',                  'Inventory',             'qc2_passed',    FALSE, 'QC2 passed — inventory ready'),
  ('QC2',                  'QC1',                   'qc2_failed',    TRUE,  'QC2 failed — back to QC1')
ON CONFLICT (from_stage_name, to_stage_name) DO NOTHING;

-- 5. Add Chip Level Repair and Body & Paint stages if missing
INSERT INTO stages (stage_name, stage_order, stage_category)
SELECT 'Chip Level Repair', 35, 'Hardware & Software'
WHERE NOT EXISTS (SELECT 1 FROM stages WHERE stage_name = 'Chip Level Repair');

INSERT INTO stages (stage_name, stage_order, stage_category)
SELECT 'Body & Paint', 36, 'Hardware & Software'
WHERE NOT EXISTS (SELECT 1 FROM stages WHERE stage_name = 'Body & Paint');

-- 6. Register new permission sections for Phase 2
INSERT INTO permission_sections (section, description, sort_order)
VALUES
  ('floor_pipeline',    'Floor Pipeline & Ticket Management', 25),
  ('floor_tickets',     'Floor Tickets (view own/team)',       26),
  ('chip_level_repair', 'Chip Level Repair',                  27),
  ('parts_inventory',   'Parts & Inventory',                  28),
  ('ttspl_history',     'TTSPL Laptop History & Audit',       29)
ON CONFLICT (section) DO UPDATE SET
  description = EXCLUDED.description,
  sort_order  = EXCLUDED.sort_order;

-- 7. Seed default role permissions for new Phase 2 sections
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin',          'floor_pipeline',    TRUE,TRUE,TRUE,TRUE),
  ('manager',        'floor_pipeline',    TRUE,TRUE,TRUE,FALSE),
  ('floor_manager',  'floor_pipeline',    TRUE,TRUE,TRUE,FALSE),
  ('technician',     'floor_pipeline',    TRUE,FALSE,TRUE,FALSE),
  ('qc',             'floor_pipeline',    TRUE,FALSE,TRUE,FALSE),
  ('admin',          'floor_tickets',     TRUE,TRUE,TRUE,TRUE),
  ('manager',        'floor_tickets',     TRUE,FALSE,TRUE,FALSE),
  ('floor_manager',  'floor_tickets',     TRUE,TRUE,TRUE,FALSE),
  ('technician',     'floor_tickets',     TRUE,FALSE,TRUE,FALSE),
  ('qc',             'floor_tickets',     TRUE,FALSE,TRUE,FALSE),
  ('admin',          'chip_level_repair', TRUE,TRUE,TRUE,TRUE),
  ('floor_manager',  'chip_level_repair', TRUE,TRUE,TRUE,FALSE),
  ('technician',     'chip_level_repair', TRUE,FALSE,TRUE,FALSE),
  ('admin',          'parts_inventory',   TRUE,TRUE,TRUE,TRUE),
  ('manager',        'parts_inventory',   TRUE,TRUE,TRUE,FALSE),
  ('floor_manager',  'parts_inventory',   TRUE,TRUE,TRUE,FALSE),
  ('technician',     'parts_inventory',   TRUE,FALSE,FALSE,FALSE),
  ('warehouse',      'parts_inventory',   TRUE,TRUE,TRUE,FALSE),
  ('admin',          'ttspl_history',     TRUE,FALSE,FALSE,FALSE),
  ('manager',        'ttspl_history',     TRUE,FALSE,FALSE,FALSE),
  ('floor_manager',  'ttspl_history',     TRUE,FALSE,FALSE,FALSE),
  ('technician',     'ttspl_history',     TRUE,FALSE,FALSE,FALSE),
  ('warehouse',      'ttspl_history',     TRUE,FALSE,FALSE,FALSE),
  ('accounts',       'ttspl_history',     TRUE,FALSE,FALSE,FALSE)
ON CONFLICT (role, section) DO NOTHING;
