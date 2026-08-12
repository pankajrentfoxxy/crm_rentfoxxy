-- ============================================================
-- Migration 098: Support Technician Parts Bucket + Challan
--   - Field part requests against a support ticket / TTSPL
--   - Warehouse approve -> challan -> e-sign -> issue to technician
--   - Technician bucket (parts held) + use / return lifecycle
-- Idempotent: safe to re-run.
-- ============================================================

-- 1. Support Part Requests
CREATE TABLE IF NOT EXISTS support_part_requests (
  id               SERIAL PRIMARY KEY,
  request_number   VARCHAR(30) NOT NULL UNIQUE,
  support_ticket_id INT NOT NULL REFERENCES support_tickets(id),
  support_item_id  INT REFERENCES support_ticket_items(id),
  ttspl_id         VARCHAR(120),
  serial_number    VARCHAR(255),
  requested_by     INT NOT NULL REFERENCES users(user_id),
  assigned_to_tech INT REFERENCES users(user_id),
  part_id          INT NOT NULL REFERENCES parts(part_id),
  quantity         INT NOT NULL DEFAULT 1,
  reason           TEXT,
  status           VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'approved',
      'challan_generated',
      'issued',
      'used',
      'return_requested',
      'returned',
      'rejected',
      'cancelled'
    )),
  instance_id      INT REFERENCES part_instances(instance_id),
  challan_id       INT,
  approved_by      INT REFERENCES users(user_id),
  approved_at      TIMESTAMPTZ,
  issued_at        TIMESTAMPTZ,
  used_at          TIMESTAMPTZ,
  return_requested_at TIMESTAMPTZ,
  returned_at      TIMESTAMPTZ,
  returned_to      INT REFERENCES users(user_id),
  rejection_reason TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spr_ticket  ON support_part_requests(support_ticket_id);
CREATE INDEX IF NOT EXISTS idx_spr_tech    ON support_part_requests(assigned_to_tech);
CREATE INDEX IF NOT EXISTS idx_spr_status  ON support_part_requests(status);

-- 2. Support Part Challans (one challan can cover multiple part requests)
CREATE TABLE IF NOT EXISTS support_part_challans (
  id               SERIAL PRIMARY KEY,
  challan_number   VARCHAR(30) NOT NULL UNIQUE,
  support_ticket_id INT NOT NULL REFERENCES support_tickets(id),
  ttspl_id         VARCHAR(120),
  issued_to        INT NOT NULL REFERENCES users(user_id),
  issued_by        INT REFERENCES users(user_id),
  issued_at        TIMESTAMPTZ,
  status           VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','issued','partially_returned','fully_returned')),

  tech_esign_url   TEXT,
  tech_esign_at    TIMESTAMPTZ,
  tech_esign_name  VARCHAR(255),

  wh_esign_url     TEXT,
  wh_esign_at      TIMESTAMPTZ,
  wh_esign_name    VARCHAR(255),

  pdf_path         TEXT,
  return_pdf_path  TEXT,

  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spc_ticket ON support_part_challans(support_ticket_id);
CREATE INDEX IF NOT EXISTS idx_spc_tech   ON support_part_challans(issued_to);

-- 3. Junction: which part_requests belong to a challan
CREATE TABLE IF NOT EXISTS support_challan_items (
  id              SERIAL PRIMARY KEY,
  challan_id      INT NOT NULL REFERENCES support_part_challans(id),
  part_request_id INT NOT NULL REFERENCES support_part_requests(id),
  part_id         INT NOT NULL REFERENCES parts(part_id),
  instance_id     INT REFERENCES part_instances(instance_id),
  prt_id          VARCHAR(30),
  part_name       VARCHAR(255),
  quantity        INT NOT NULL DEFAULT 1,
  unit_cost       NUMERIC(10,2) DEFAULT 0,
  returned_qty    INT DEFAULT 0,
  return_status   VARCHAR(20) DEFAULT 'held'
    CHECK (return_status IN ('held','used','returned')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sci_challan ON support_challan_items(challan_id);

-- 4. Document sequences
INSERT INTO sm_document_sequences (doc_type, last_value, prefix)
VALUES
  ('support_part_request', 0, 'SPR-'),
  ('support_part_challan', 0, 'SPC-')
ON CONFLICT (doc_type) DO NOTHING;

-- 5. Allow technician + vendor-repair statuses on part_instances
ALTER TABLE part_instances
  DROP CONSTRAINT IF EXISTS part_instances_status_check;
ALTER TABLE part_instances
  ADD CONSTRAINT part_instances_status_check
  CHECK (status IN (
    'in_stock','reserved','installed','defective',
    'returned','discarded','sold','with_technician',
    'in_transit','with_vendor_repair','qc_pending'
  ));

-- 6. FK back-link from support_part_requests to challan
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_spr_challan'
      AND table_name = 'support_part_requests'
  ) THEN
    ALTER TABLE support_part_requests
      ADD CONSTRAINT fk_spr_challan
      FOREIGN KEY (challan_id) REFERENCES support_part_challans(id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

-- 7. Permissions
INSERT INTO permission_sections (section, description, sort_order)
VALUES
  ('support_part_requests', 'Support Part Requests (Field)',    325),
  ('support_part_challan',  'Support Part Challans (Warehouse)', 326)
ON CONFLICT (section) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('support_tech',  'support_part_requests', true, true,  true,  false),
  ('support_lead',  'support_part_requests', true, true,  true,  true),
  ('warehouse',     'support_part_requests', true, false, true,  false),
  ('admin',         'support_part_requests', true, true,  true,  true),
  ('manager',       'support_part_requests', true, false, true,  false),
  ('warehouse',     'support_part_challan',  true, true,  true,  false),
  ('support_lead',  'support_part_challan',  true, true,  true,  false),
  ('admin',         'support_part_challan',  true, true,  true,  true),
  ('manager',       'support_part_challan',  true, false, false, false)
ON CONFLICT (role, section) DO NOTHING;
