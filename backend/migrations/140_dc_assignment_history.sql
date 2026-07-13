-- Delivery challan assignee change history (technician / courier / porter).

CREATE TABLE IF NOT EXISTS dc_assignment_history (
  id SERIAL PRIMARY KEY,
  dc_number VARCHAR(100) NOT NULL,
  sales_order_number VARCHAR(100),
  previous_dispatch_mode VARCHAR(32),
  new_dispatch_mode VARCHAR(32),
  previous_assignee_label VARCHAR(500),
  new_assignee_label VARCHAR(500),
  previous_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  new_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT,
  changed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  changed_by_name VARCHAR(255),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dc_assignment_history_dc
  ON dc_assignment_history (dc_number, changed_at DESC);
