-- Purchase order activity audit trail (per PO timeline).
CREATE TABLE IF NOT EXISTS purchase_order_activities (
  id SERIAL PRIMARY KEY,
  po_id INTEGER NOT NULL REFERENCES vendor_purchase_orders(po_id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_po_activities_po_id
  ON purchase_order_activities (po_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_po_activities_type
  ON purchase_order_activities (activity_type, action);
