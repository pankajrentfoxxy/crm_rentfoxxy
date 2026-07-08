-- Sales order activity audit trail (per SO timeline).
CREATE TABLE IF NOT EXISTS sales_order_activities (
  id SERIAL PRIMARY KEY,
  sales_order_number VARCHAR(50) NOT NULL,
  activity_type VARCHAR(50) NOT NULL,
  action VARCHAR(100) NOT NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  remarks TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  created_by_name VARCHAR(255),
  created_by_role VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_so_activities_so_number
  ON sales_order_activities (sales_order_number, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_so_activities_type
  ON sales_order_activities (activity_type, action);
