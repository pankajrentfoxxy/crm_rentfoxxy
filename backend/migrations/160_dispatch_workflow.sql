-- Phase 1: Dispatch workflow orchestration (SO → assign → accept → attach → QC → DC → customer asset)

CREATE TABLE IF NOT EXISTS dispatch_workflow_config (
  id INT PRIMARY KEY DEFAULT 1,
  acceptance_sla_minutes INT NOT NULL DEFAULT 30,
  reminder_interval_minutes INT NOT NULL DEFAULT 10,
  qc_eta_minutes INT NOT NULL DEFAULT 120,
  qc_buffer_minutes INT NOT NULL DEFAULT 60,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT dispatch_workflow_config_single CHECK (id = 1)
);
INSERT INTO dispatch_workflow_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS dispatch_round_robin_state (
  id INT PRIMARY KEY DEFAULT 1,
  last_assigned_user_id INT,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT dispatch_rr_single CHECK (id = 1)
);
INSERT INTO dispatch_round_robin_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS sales_order_procurement_requests (
  id SERIAL PRIMARY KEY,
  sales_order_number VARCHAR(64) NOT NULL,
  line_id INT,
  customer_id INT,
  status VARCHAR(32) NOT NULL DEFAULT 'New',
  priority VARCHAR(16) NOT NULL DEFAULT 'normal',
  spec JSONB,
  quantity INT NOT NULL DEFAULT 1,
  notes TEXT,
  created_by INT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_so_pr_so ON sales_order_procurement_requests (sales_order_number);

CREATE TABLE IF NOT EXISTS dispatch_workflow (
  id SERIAL PRIMARY KEY,
  sales_order_number VARCHAR(64) NOT NULL UNIQUE,
  quotation_type VARCHAR(16),
  assigned_user_id INT REFERENCES users(user_id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ,
  assignment_sequence INT,
  status VARCHAR(32) NOT NULL DEFAULT 'waiting_acceptance',
  accepted_by INT REFERENCES users(user_id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  acceptance_due_at TIMESTAMPTZ,
  last_reminder_at TIMESTAMPTZ,
  qc_started_at TIMESTAMPTZ,
  qc_due_at TIMESTAMPTZ,
  qc_passed_at TIMESTAMPTZ,
  qc_overdue BOOLEAN NOT NULL DEFAULT FALSE,
  purchase_request_id INT REFERENCES sales_order_procurement_requests(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dw_status ON dispatch_workflow (status);
CREATE INDEX IF NOT EXISTS idx_dw_assigned ON dispatch_workflow (assigned_user_id, status);
CREATE INDEX IF NOT EXISTS idx_dw_acceptance_due ON dispatch_workflow (acceptance_due_at)
  WHERE status = 'waiting_acceptance';

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  type VARCHAR(48) NOT NULL,
  title TEXT,
  body TEXT,
  sales_order_number VARCHAR(64),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications (user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications (user_id, created_at DESC);

INSERT INTO permission_sections (section, description, sort_order)
VALUES ('dispatch_workflow', 'Dispatch Workflow (SO orchestration)', 178)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('super_admin', 'dispatch_workflow', true, true, true, false),
  ('admin', 'dispatch_workflow', true, true, true, false),
  ('dispatch', 'dispatch_workflow', true, true, true, false),
  ('manager', 'dispatch_workflow', true, false, false, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = GREATEST(role_permissions.can_view, EXCLUDED.can_view),
      can_create = GREATEST(role_permissions.can_create, EXCLUDED.can_create),
      can_edit = GREATEST(role_permissions.can_edit, EXCLUDED.can_edit);
