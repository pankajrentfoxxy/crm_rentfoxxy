-- Activity log for customer-held asset edits (specs, DC, delivery date, rate).
CREATE TABLE IF NOT EXISTS customer_asset_activity (
  id SERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
  vendor_serial_id INT REFERENCES vendor_serial_numbers(serial_id) ON DELETE SET NULL,
  ttspl_id VARCHAR(100),
  serial_number VARCHAR(255),
  action VARCHAR(50) NOT NULL DEFAULT 'asset_updated',
  description TEXT NOT NULL,
  changes JSONB NOT NULL DEFAULT '[]'::jsonb,
  actor_user_id INT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_asset_activity_customer
  ON customer_asset_activity (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_customer_asset_activity_serial
  ON customer_asset_activity (vendor_serial_id, created_at DESC);
