-- Append-only floor production workflow history (does not replace activities/work_logs).

CREATE TABLE IF NOT EXISTS production_ticket_history (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(ticket_id) ON DELETE CASCADE,
  ttspl_id VARCHAR(100),
  previous_stage VARCHAR(100),
  current_stage VARCHAR(100),
  previous_team VARCHAR(150),
  current_team VARCHAR(150),
  previous_technician_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  current_technician_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  previous_technician VARCHAR(255),
  current_technician VARCHAR(255),
  previous_status VARCHAR(50),
  current_status VARCHAR(50),
  action VARCHAR(120) NOT NULL,
  remarks TEXT,
  failure_reason TEXT,
  performed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  performed_by_name VARCHAR(255),
  performed_by_role VARCHAR(50),
  source VARCHAR(80),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_production_ticket_history_ticket
  ON production_ticket_history (ticket_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_production_ticket_history_ttspl
  ON production_ticket_history (ttspl_id, created_at DESC)
  WHERE ttspl_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_production_ticket_history_action
  ON production_ticket_history (action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_production_ticket_history_stage
  ON production_ticket_history (current_stage, created_at DESC);

CREATE TABLE IF NOT EXISTS production_assignment_history (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(ticket_id) ON DELETE CASCADE,
  technician_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  technician_name VARCHAR(255),
  team_id INTEGER REFERENCES teams(team_id) ON DELETE SET NULL,
  team_name VARCHAR(150),
  assigned_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  assigned_by_name VARCHAR(255),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unassigned_at TIMESTAMPTZ,
  assignment_type VARCHAR(80),
  stage_name VARCHAR(100),
  remarks TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_production_assignment_history_ticket
  ON production_assignment_history (ticket_id, assigned_at DESC);

CREATE INDEX IF NOT EXISTS idx_production_assignment_history_technician
  ON production_assignment_history (technician_id, assigned_at DESC)
  WHERE technician_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_production_assignment_history_open
  ON production_assignment_history (ticket_id)
  WHERE unassigned_at IS NULL;
