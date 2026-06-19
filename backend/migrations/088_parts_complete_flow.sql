-- ============================================================
-- Migration 088: Complete Parts Management Flow (Phase 16)
-- Purchase -> Inventory (PRT instances) -> Request -> Approval
-- -> Attach -> Config update -> Expense tracking
-- ============================================================

-- 1. Parts catalog — extra categorisation fields + updated_at (used by services)
ALTER TABLE parts
  ADD COLUMN IF NOT EXISTS part_sku          VARCHAR(100),
  ADD COLUMN IF NOT EXISTS compatible_brands TEXT[],
  ADD COLUMN IF NOT EXISTS compatible_models TEXT[],
  ADD COLUMN IF NOT EXISTS is_consumable     BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS warranty_months   INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS notes             TEXT,
  ADD COLUMN IF NOT EXISTS archived          BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ DEFAULT NOW();

-- 2. Part Instances — each PHYSICAL unit of a part has a unique PRT-ID
CREATE TABLE IF NOT EXISTS part_instances (
  instance_id          SERIAL PRIMARY KEY,
  prt_id               VARCHAR(30) NOT NULL UNIQUE,
  part_id              INT NOT NULL REFERENCES parts(part_id),
  spo_id               INT REFERENCES vendor_spare_parts_purchase_orders(spo_id),
  grn_id               INT,
  batch_number         VARCHAR(50),
  unit_cost            NUMERIC(10,2) NOT NULL DEFAULT 0,
  status               VARCHAR(30) NOT NULL DEFAULT 'in_stock'
    CHECK (status IN ('in_stock','reserved','installed','defective','returned','discarded','sold')),
  location_code        VARCHAR(100),
  installed_ttspl_id   VARCHAR(50),
  installed_ticket_id  INT REFERENCES tickets(ticket_id),
  installed_at         TIMESTAMPTZ,
  removed_at           TIMESTAMPTZ,
  condition_on_removal VARCHAR(20),
  notes                TEXT,
  received_at          TIMESTAMPTZ DEFAULT NOW(),
  received_by          INT REFERENCES users(user_id),
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_part_instances_part_id ON part_instances(part_id);
CREATE INDEX IF NOT EXISTS idx_part_instances_status  ON part_instances(status);
CREATE INDEX IF NOT EXISTS idx_part_instances_ttspl   ON part_instances(installed_ttspl_id);

-- 3. Part Requests — EXTEND existing basic table
ALTER TABLE part_requests
  ADD COLUMN IF NOT EXISTS request_number   VARCHAR(30),
  ADD COLUMN IF NOT EXISTS request_type     VARCHAR(20) DEFAULT 'replacement',
  ADD COLUMN IF NOT EXISTS part_id          INT REFERENCES parts(part_id),
  ADD COLUMN IF NOT EXISTS quantity         INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS stage_name       VARCHAR(100),
  ADD COLUMN IF NOT EXISTS ticket_stage_id  INT,
  ADD COLUMN IF NOT EXISTS config_field     VARCHAR(50),
  ADD COLUMN IF NOT EXISTS old_value        VARCHAR(200),
  ADD COLUMN IF NOT EXISTS new_value        VARCHAR(200),
  ADD COLUMN IF NOT EXISTS blocks_stage     BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS approved_by      INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS approved_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS escalated_by     INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS escalated_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS spo_id           INT REFERENCES vendor_spare_parts_purchase_orders(spo_id),
  ADD COLUMN IF NOT EXISTS instance_id      INT REFERENCES part_instances(instance_id),
  ADD COLUMN IF NOT EXISTS attached_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attached_by      INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS old_part_returned    BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS old_part_returned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS old_part_condition   VARCHAR(20),
  ADD COLUMN IF NOT EXISTS old_part_notes       TEXT,
  ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMPTZ DEFAULT NOW();

-- Backfill request numbers for existing rows
UPDATE part_requests SET request_number = 'PRQ-' || LPAD(request_id::text, 4, '0')
WHERE request_number IS NULL;

-- 4. Document sequences for part requests and PRT instance IDs
INSERT INTO sm_document_sequences (doc_type, last_value, prefix)
VALUES
  ('part_request',  0, 'PRQ-'),
  ('part_instance', 0, 'PRT-')
ON CONFLICT (doc_type) DO NOTHING;

-- 5. Ticket part blocking — track which tickets are blocked by a request
CREATE TABLE IF NOT EXISTS ticket_part_blocks (
  block_id     SERIAL PRIMARY KEY,
  ticket_id    INT NOT NULL REFERENCES tickets(ticket_id),
  request_id   INT NOT NULL REFERENCES part_requests(request_id),
  blocked_at   TIMESTAMPTZ DEFAULT NOW(),
  unblocked_at TIMESTAMPTZ,
  is_active    BOOLEAN DEFAULT TRUE,
  UNIQUE (ticket_id, request_id)
);

-- 6. Denormalised open-request counter on tickets
ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS open_part_requests INT DEFAULT 0;

-- 7. Permission sections for parts management
INSERT INTO permission_sections (section, description, sort_order)
VALUES
  ('parts_requests',    'Part Requests (Floor)',             280),
  ('parts_approval',    'Part Request Approval (Warehouse)', 281),
  ('parts_procurement', 'Parts Procurement',                 282)
ON CONFLICT (section) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin',        'parts_requests',    true,true,true,true),
  ('manager',      'parts_requests',    true,true,true,false),
  ('floor_manager','parts_requests',    true,true,true,false),
  ('team_member',  'parts_requests',    true,true,false,false),
  ('team_lead',    'parts_requests',    true,true,true,false),
  ('qc',           'parts_requests',    true,true,false,false),
  ('admin',        'parts_approval',    true,true,true,true),
  ('manager',      'parts_approval',    true,true,true,false),
  ('warehouse',    'parts_approval',    true,false,true,false),
  ('admin',        'parts_procurement', true,true,true,true),
  ('manager',      'parts_procurement', true,true,true,false),
  ('procurement',  'parts_procurement', true,true,true,false)
ON CONFLICT (role, section) DO NOTHING;
