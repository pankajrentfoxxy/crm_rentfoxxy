-- Migration: 201_support_qr_requests.sql
-- QR / public support intake requests (pending → reviewed → converted).

CREATE TABLE IF NOT EXISTS support_requests (
  id                SERIAL PRIMARY KEY,
  customer_name     VARCHAR(255) NOT NULL,
  mobile_number     VARCHAR(20) NOT NULL,
  company_name      VARCHAR(255),
  issue_description TEXT NOT NULL,
  device_serial     VARCHAR(120),
  source            VARCHAR(40) NOT NULL DEFAULT 'qr',
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'reviewed', 'converted', 'dismissed')),
  ticket_id         INTEGER REFERENCES support_tickets (id) ON DELETE SET NULL,
  matched_customer_id INTEGER,
  reviewed_by       INTEGER REFERENCES users (user_id) ON DELETE SET NULL,
  reviewed_at       TIMESTAMPTZ,
  converted_by      INTEGER REFERENCES users (user_id) ON DELETE SET NULL,
  converted_at      TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_requests_status ON support_requests (status);
CREATE INDEX IF NOT EXISTS idx_support_requests_created ON support_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_requests_mobile ON support_requests (mobile_number);

INSERT INTO permission_sections (section, description, sort_order)
VALUES (
  'support_requests',
  'QR / public Support Requests inbox',
  72
)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin',         'support_requests', true, true, true, true),
  ('super_admin',   'support_requests', true, true, true, true),
  ('manager',       'support_requests', true, true, true, false),
  ('support_lead',  'support_requests', true, true, true, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit,
      can_delete = EXCLUDED.can_delete;

-- Anyone who can view support tickets gets Support Requests
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT DISTINCT ON (rp.role)
       rp.role, 'support_requests', true, rp.can_create, rp.can_edit, false
  FROM role_permissions rp
 WHERE rp.section = 'support_tickets'
   AND rp.can_view = true
ON CONFLICT (role, section) DO NOTHING;

INSERT INTO user_permissions (user_id, section, can_view, can_create, can_edit, can_delete)
SELECT DISTINCT up.user_id, 'support_requests', true, false, false, false
  FROM user_permissions up
 WHERE up.section = 'support_tickets'
   AND up.can_view = true
ON CONFLICT (user_id, section) DO NOTHING;
