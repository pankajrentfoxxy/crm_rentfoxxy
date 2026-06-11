-- Vendor portal sessions (JWT token tracking for logout / expiry)

CREATE TABLE IF NOT EXISTS vendor_portal_sessions (
  session_id SERIAL PRIMARY KEY,
  vendor_id INT NOT NULL REFERENCES vendors(vendor_id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_portal_sessions_vendor ON vendor_portal_sessions (vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_portal_sessions_expires ON vendor_portal_sessions (expires_at);
