-- Phase 6: Support module enhancements + customer portal sessions

CREATE TABLE IF NOT EXISTS customer_portal_sessions (
  session_id  SERIAL PRIMARY KEY,
  customer_id INT NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_portal_sessions_customer
  ON customer_portal_sessions (customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_portal_sessions_expires
  ON customer_portal_sessions (expires_at);

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS portal_password_hash  TEXT,
  ADD COLUMN IF NOT EXISTS portal_last_login      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS portal_enabled         BOOLEAN DEFAULT FALSE;

ALTER TABLE support_tickets
  ADD COLUMN IF NOT EXISTS ttspl_id               VARCHAR(50),
  ADD COLUMN IF NOT EXISTS dc_number              VARCHAR(50),
  ADD COLUMN IF NOT EXISTS sales_order_number     VARCHAR(50),
  ADD COLUMN IF NOT EXISTS customer_portal_ticket BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS portal_customer_id     INT REFERENCES customers(customer_id);

INSERT INTO permission_sections (section, description, sort_order)
VALUES
  ('support_tickets',  'Support Ticket Management',  300),
  ('support_settings', 'Support Module Settings',    301)
ON CONFLICT (section) DO UPDATE SET
  description = EXCLUDED.description,
  sort_order  = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin',   'support_tickets',  TRUE,TRUE,TRUE,TRUE),
  ('manager', 'support_tickets',  TRUE,TRUE,TRUE,FALSE),
  ('support', 'support_tickets',  TRUE,TRUE,TRUE,FALSE),
  ('sales',   'support_tickets',  TRUE,FALSE,FALSE,FALSE),
  ('accounts','support_tickets',  TRUE,FALSE,FALSE,FALSE),
  ('admin',   'support_settings', TRUE,TRUE,TRUE,TRUE),
  ('manager', 'support_settings', TRUE,FALSE,TRUE,FALSE)
ON CONFLICT (role, section) DO NOTHING;
