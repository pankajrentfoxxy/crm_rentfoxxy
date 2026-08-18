-- ============================================================
-- Migration 201: Support revamp — core object model
--   Number is 201 (not 196) because 196–200 already exist.
-- Idempotent. PLAN §21 reconstructed from later phase column use
-- because SUPPORT_REVAMP_PLAN.md is not in the repo.
-- ============================================================

CREATE TABLE IF NOT EXISTS support_tickets_v2 (
  ticket_id                 SERIAL PRIMARY KEY,
  ticket_number             VARCHAR(40) NOT NULL UNIQUE,
  ticket_class              VARCHAR(10) NOT NULL
                              CHECK (ticket_class IN ('INCIDENT','REQUEST')),
  channel                   VARCHAR(20) NOT NULL DEFAULT 'PHONE'
                              CHECK (channel IN ('PHONE','EMAIL','WHATSAPP','PORTAL','INTERNAL','CHAT')),
  channel_inferred          BOOLEAN NOT NULL DEFAULT FALSE,
  status                    VARCHAR(20) NOT NULL DEFAULT 'NEW'
                              CHECK (status IN (
                                'NEW','TRIAGED','ASSIGNED','IN_PROGRESS','PENDING',
                                'RESOLVED','CLOSED','CANCELLED'
                              )),
  pending_reason            VARCHAR(30)
                              CHECK (pending_reason IS NULL OR pending_reason IN (
                                'PENDING_CUSTOMER','PENDING_VENDOR','PENDING_APPROVAL',
                                'PENDING_PART','PENDING_WAREHOUSE'
                              )),
  priority                  SMALLINT NOT NULL DEFAULT 3 CHECK (priority IN (1,2,3,4)),
  priority_overridden       BOOLEAN NOT NULL DEFAULT FALSE,
  priority_override_reason  VARCHAR(80),
  impact                    SMALLINT CHECK (impact IS NULL OR impact IN (1,2,3)),
  urgency                   SMALLINT CHECK (urgency IS NULL OR urgency IN (1,2,3)),
  customer_id               INT REFERENCES customers(customer_id),
  site_id                   INT,
  site_label                VARCHAR(200),
  contact_name              VARCHAR(120),
  contact_phone             VARCHAR(40),
  contact_email             VARCHAR(120),
  contact_is_vip            BOOLEAN NOT NULL DEFAULT FALSE,
  subject                   TEXT,
  assignment_group_id       INT,
  assigned_to               INT REFERENCES users(user_id),
  preferred_slot_start      TIMESTAMPTZ,
  preferred_slot_end        TIMESTAMPTZ,
  internal_note             TEXT,
  sla_policy_id             INT,
  sla_response_due_at       TIMESTAMPTZ,
  sla_resolution_due_at     TIMESTAMPTZ,
  sla_started_at            TIMESTAMPTZ,
  sla_paused_minutes        INT NOT NULL DEFAULT 0,
  sla_paused                BOOLEAN NOT NULL DEFAULT FALSE,
  sla_breached              BOOLEAN NOT NULL DEFAULT FALSE,
  sla_resolution_breached   BOOLEAN NOT NULL DEFAULT FALSE,
  breach_reason             TEXT,
  csat_score                SMALLINT,
  csat_comment              TEXT,
  csat_requested_at         TIMESTAMPTZ,
  csat_responded_at         TIMESTAMPTZ,
  created_by                INT REFERENCES users(user_id),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at               TIMESTAMPTZ,
  closed_at                 TIMESTAMPTZ,
  legacy_ticket_id          INT,
  legacy_ticket_number      VARCHAR(40),
  migration_confidence      VARCHAR(10)
                              CHECK (migration_confidence IS NULL OR migration_confidence IN ('HIGH','MEDIUM','LOW')),
  demo_seed                 BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_stk2_legacy ON support_tickets_v2(legacy_ticket_id);
CREATE INDEX IF NOT EXISTS idx_stk2_status ON support_tickets_v2(status);
CREATE INDEX IF NOT EXISTS idx_stk2_customer ON support_tickets_v2(customer_id);
CREATE INDEX IF NOT EXISTS idx_stk2_assigned ON support_tickets_v2(assigned_to);
CREATE INDEX IF NOT EXISTS idx_stk2_legacy_number ON support_tickets_v2(legacy_ticket_number);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stk2_legacy_ticket
  ON support_tickets_v2(legacy_ticket_id) WHERE legacy_ticket_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS support_ticket_assets (
  line_id                 SERIAL PRIMARY KEY,
  ticket_id               INT NOT NULL REFERENCES support_tickets_v2(ticket_id) ON DELETE CASCADE,
  line_code               VARCHAR(8) NOT NULL DEFAULT 'A1',
  serial_id               INT,
  ttspl_id                VARCHAR(40),
  serial_number           VARCHAR(120),
  asset_unknown           BOOLEAN NOT NULL DEFAULT FALSE,
  reported_type_id        INT NOT NULL REFERENCES support_issue_catalog(catalog_id),
  reported_subtype_id     INT NOT NULL REFERENCES support_issue_catalog(catalog_id),
  reported_issue_id       INT NOT NULL REFERENCES support_issue_catalog(catalog_id),
  reported_description    TEXT,
  found_type_id           INT REFERENCES support_issue_catalog(catalog_id),
  found_subtype_id        INT REFERENCES support_issue_catalog(catalog_id),
  found_issue_id          INT REFERENCES support_issue_catalog(catalog_id),
  impact                  SMALLINT CHECK (impact IS NULL OR impact IN (1,2,3)),
  urgency                 SMALLINT CHECK (urgency IS NULL OR urgency IN (1,2,3)),
  is_repeat               BOOLEAN NOT NULL DEFAULT FALSE,
  repeat_of_ticket_id     INT REFERENCES support_tickets_v2(ticket_id),
  is_safety               BOOLEAN NOT NULL DEFAULT FALSE,
  line_status             VARCHAR(20) NOT NULL DEFAULT 'OPEN'
                            CHECK (line_status IN ('OPEN','IN_PROGRESS','PENDING','RESOLVED','CANCELLED')),
  resolution_code_id      INT REFERENCES support_resolution_codes(code_id),
  root_cause_id           INT REFERENCES support_root_causes(cause_id),
  liability               VARCHAR(30)
                            CHECK (liability IS NULL OR liability IN
                              ('COMPANY','CUSTOMER_CHARGEABLE','VENDOR_WARRANTY','INSURANCE','NONE')),
  chargeable_amount       NUMERIC(12,2),
  resolution_notes        TEXT,
  legacy_item_id          INT,
  demo_seed               BOOLEAN NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stk2_assets_ticket ON support_ticket_assets(ticket_id);
CREATE INDEX IF NOT EXISTS idx_stk2_assets_serial ON support_ticket_assets(serial_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_stk2_assets_legacy
  ON support_ticket_assets(legacy_item_id) WHERE legacy_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS support_work_orders (
  wo_id                   SERIAL PRIMARY KEY,
  wo_number               VARCHAR(20) NOT NULL UNIQUE,
  ticket_id               INT NOT NULL REFERENCES support_tickets_v2(ticket_id) ON DELETE CASCADE,
  wo_type                 VARCHAR(30) NOT NULL
                            CHECK (wo_type IN (
                              'FIELD_VISIT','REPAIR_PICKUP','RETURN_PICKUP','SERVICE_RETURN',
                              'REPLACEMENT_DELIVERY','PART_DELIVERY','PART_RETURN','REMOTE_FIX'
                            )),
  status                  VARCHAR(30) NOT NULL DEFAULT 'DRAFT'
                            CHECK (status IN (
                              'DRAFT','PENDING_ASSIGNMENT','ASSIGNED','ACCEPTED','EN_ROUTE',
                              'ON_SITE','IN_PROGRESS','COMPLETED','FAILED','CANCELLED'
                            )),
  assigned_to             INT REFERENCES users(user_id),
  assignment_group_id     INT,
  scheduled_start         TIMESTAMPTZ,
  scheduled_end           TIMESTAMPTZ,
  method                  VARCHAR(20),
  notes                   TEXT,
  customer_otp            VARCHAR(6),
  otp_verified_at         TIMESTAMPTZ,
  failure_reason          VARCHAR(40),
  attempt_number          INT NOT NULL DEFAULT 1,
  previous_wo_id          INT REFERENCES support_work_orders(wo_id),
  replacement_group_id    VARCHAR(40),
  bulk_group_id           VARCHAR(40),
  linked_wo_id            INT,
  legacy_item_id          INT,
  migration_confidence    VARCHAR(10)
                            CHECK (migration_confidence IS NULL OR migration_confidence IN ('HIGH','MEDIUM','LOW')),
  migration_rule          VARCHAR(40),
  demo_seed               BOOLEAN NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at            TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_wo_ticket ON support_work_orders(ticket_id);
CREATE INDEX IF NOT EXISTS idx_wo_assigned ON support_work_orders(assigned_to);
CREATE INDEX IF NOT EXISTS idx_wo_status ON support_work_orders(status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_wo_legacy_item
  ON support_work_orders(legacy_item_id) WHERE legacy_item_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS support_work_order_assets (
  wo_asset_id  SERIAL PRIMARY KEY,
  wo_id        INT NOT NULL REFERENCES support_work_orders(wo_id) ON DELETE CASCADE,
  line_id      INT NOT NULL REFERENCES support_ticket_assets(line_id) ON DELETE CASCADE,
  UNIQUE (wo_id, line_id)
);

CREATE TABLE IF NOT EXISTS support_work_order_type_config (
  config_id     SERIAL PRIMARY KEY,
  wo_type       VARCHAR(30) NOT NULL,
  step_code     VARCHAR(40) NOT NULL,
  step_label    VARCHAR(80) NOT NULL,
  step_kind     VARCHAR(20) NOT NULL
                  CHECK (step_kind IN ('CONFIRM','GPS','SCAN','CHECKLIST','PHOTO','FORM','OTP','SIGNATURE')),
  is_mandatory  BOOLEAN NOT NULL DEFAULT TRUE,
  min_count     INT NOT NULL DEFAULT 1,
  sort_order    INT NOT NULL DEFAULT 0,
  UNIQUE (wo_type, step_code)
);

CREATE TABLE IF NOT EXISTS support_work_order_steps (
  step_id       SERIAL PRIMARY KEY,
  wo_id         INT NOT NULL REFERENCES support_work_orders(wo_id) ON DELETE CASCADE,
  step_code     VARCHAR(40) NOT NULL,
  step_label    VARCHAR(80) NOT NULL,
  step_kind     VARCHAR(20) NOT NULL,
  is_mandatory  BOOLEAN NOT NULL DEFAULT TRUE,
  min_count     INT NOT NULL DEFAULT 1,
  sort_order    INT NOT NULL DEFAULT 0,
  status        VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','DONE','SKIPPED')),
  payload       JSONB,
  completed_at  TIMESTAMPTZ,
  completed_by  INT REFERENCES users(user_id),
  UNIQUE (wo_id, step_code)
);

CREATE TABLE IF NOT EXISTS support_work_order_actions (
  wo_action_id    SERIAL PRIMARY KEY,
  wo_id           INT NOT NULL REFERENCES support_work_orders(wo_id) ON DELETE CASCADE,
  action_code_id  INT NOT NULL REFERENCES support_action_codes(action_id),
  UNIQUE (wo_id, action_code_id)
);

CREATE TABLE IF NOT EXISTS support_ticket_events (
  event_id             BIGSERIAL PRIMARY KEY,
  ticket_id            INT NOT NULL REFERENCES support_tickets_v2(ticket_id) ON DELETE CASCADE,
  line_id              INT REFERENCES support_ticket_assets(line_id) ON DELETE SET NULL,
  wo_id                INT REFERENCES support_work_orders(wo_id) ON DELETE SET NULL,
  event_type           VARCHAR(60) NOT NULL,
  actor_id             INT,
  actor_kind           VARCHAR(20) NOT NULL DEFAULT 'USER'
                         CHECK (actor_kind IN ('USER','SYSTEM','CUSTOMER','TECH')),
  summary              TEXT,
  detail               JSONB,
  is_customer_visible  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stk2_events_ticket ON support_ticket_events(ticket_id, created_at);

CREATE TABLE IF NOT EXISTS support_attachments (
  attachment_id  SERIAL PRIMARY KEY,
  ticket_id      INT REFERENCES support_tickets_v2(ticket_id) ON DELETE CASCADE,
  line_id        INT REFERENCES support_ticket_assets(line_id) ON DELETE SET NULL,
  wo_id          INT REFERENCES support_work_orders(wo_id) ON DELETE SET NULL,
  kind           VARCHAR(30) NOT NULL DEFAULT 'FILE',
  file_path      TEXT NOT NULL,
  original_name  VARCHAR(200),
  mime_type      VARCHAR(80),
  uploaded_by    INT REFERENCES users(user_id),
  demo_seed      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_migration_review (
  legacy_item_id  INT PRIMARY KEY,
  decision        VARCHAR(20) NOT NULL CHECK (decision IN ('repair','return')),
  decided_by      INT REFERENCES users(user_id),
  decided_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note            TEXT
);

-- Checkpoint definitions (PLAN §10.2) — all eight WO types
INSERT INTO support_work_order_type_config (wo_type, step_code, step_label, step_kind, is_mandatory, min_count, sort_order) VALUES
  -- REPAIR_PICKUP
  ('REPAIR_PICKUP','DOC_GENERATED','Return DC generated','CONFIRM',  true, 1, 10),
  ('REPAIR_PICKUP','ON_SITE_GPS','Arrived on site','GPS',            true, 1, 20),
  ('REPAIR_PICKUP','SERIAL_SCAN','Scan machine serial','SCAN',       true, 1, 30),
  ('REPAIR_PICKUP','ACCESSORIES','Accessories checklist','CHECKLIST',true, 1, 40),
  ('REPAIR_PICKUP','PHOTO_CONDITION','Condition photos','PHOTO',     true, 4, 50),
  ('REPAIR_PICKUP','DIAGNOSIS','Diagnosis on site','FORM',           true, 1, 60),
  ('REPAIR_PICKUP','CUSTOMER_OTP','Customer OTP','OTP',              true, 1, 70),
  ('REPAIR_PICKUP','TECH_ESIGN','Technician signature','SIGNATURE',  true, 1, 80),
  ('REPAIR_PICKUP','WH_RECEIPT','Warehouse receipt scan','SCAN',     false,1, 90),
  -- RETURN_PICKUP
  ('RETURN_PICKUP','DOC_GENERATED','Return DC generated','CONFIRM',  true, 1, 10),
  ('RETURN_PICKUP','ON_SITE_GPS','Arrived on site','GPS',            true, 1, 20),
  ('RETURN_PICKUP','SERIAL_SCAN','Scan machine serial','SCAN',       true, 1, 30),
  ('RETURN_PICKUP','ACCESSORIES','Accessories checklist','CHECKLIST',true, 1, 40),
  ('RETURN_PICKUP','PHOTO_CONDITION','Condition photos','PHOTO',     true, 4, 50),
  ('RETURN_PICKUP','GRADE','Condition grade','FORM',                 true, 1, 60),
  ('RETURN_PICKUP','CUSTOMER_OTP','Customer OTP','OTP',              true, 1, 70),
  ('RETURN_PICKUP','TECH_ESIGN','Technician signature','SIGNATURE',  true, 1, 80),
  ('RETURN_PICKUP','WH_RECEIPT','Warehouse receipt scan','SCAN',     false,1, 90),
  -- SERVICE_RETURN
  ('SERVICE_RETURN','DOC_GENERATED','Service DC generated','CONFIRM',true, 1, 10),
  ('SERVICE_RETURN','SERIAL_SCAN','Scan machine serial','SCAN',      true, 1, 20),
  ('SERVICE_RETURN','PHOTO_CONDITION','Condition photos','PHOTO',    true, 2, 30),
  ('SERVICE_RETURN','CUSTOMER_OTP','Customer OTP','OTP',             true, 1, 40),
  ('SERVICE_RETURN','TECH_ESIGN','Technician signature','SIGNATURE', true, 1, 50),
  -- FIELD_VISIT
  ('FIELD_VISIT','ON_SITE_GPS','Arrived on site','GPS',              true, 1, 10),
  ('FIELD_VISIT','SERIAL_SCAN','Scan machine serial','SCAN',         true, 1, 20),
  ('FIELD_VISIT','PHOTO_CONDITION','Condition photos','PHOTO',       true, 2, 30),
  ('FIELD_VISIT','DIAGNOSIS','Diagnosis on site','FORM',             true, 1, 40),
  ('FIELD_VISIT','CUSTOMER_OTP','Customer OTP','OTP',                true, 1, 50),
  ('FIELD_VISIT','TECH_ESIGN','Technician signature','SIGNATURE',    true, 1, 60),
  -- REMOTE_FIX
  ('REMOTE_FIX','REMOTE_START','Remote session started','CONFIRM',   true, 1, 10),
  ('REMOTE_FIX','DIAGNOSIS','Remote diagnosis','FORM',               true, 1, 20),
  ('REMOTE_FIX','RESOLUTION','Resolution notes','FORM',              true, 1, 30),
  -- REPLACEMENT_DELIVERY
  ('REPLACEMENT_DELIVERY','DOC_GENERATED','Delivery DC generated','CONFIRM', true, 1, 10),
  ('REPLACEMENT_DELIVERY','ON_SITE_GPS','Arrived on site','GPS',      true, 1, 20),
  ('REPLACEMENT_DELIVERY','SERIAL_SCAN','Scan replacement serial','SCAN', true, 1, 30),
  ('REPLACEMENT_DELIVERY','PHOTO_CONDITION','Handover photos','PHOTO', true, 2, 40),
  ('REPLACEMENT_DELIVERY','CUSTOMER_OTP','Customer OTP','OTP',        true, 1, 50),
  ('REPLACEMENT_DELIVERY','TECH_ESIGN','Technician signature','SIGNATURE', true, 1, 60),
  -- PART_DELIVERY
  ('PART_DELIVERY','PART_SCAN','Scan part serial','SCAN',            true, 1, 10),
  ('PART_DELIVERY','ON_SITE_GPS','Arrived on site','GPS',            true, 1, 20),
  ('PART_DELIVERY','CUSTOMER_OTP','Customer OTP','OTP',              true, 1, 30),
  ('PART_DELIVERY','TECH_ESIGN','Technician signature','SIGNATURE',  true, 1, 40),
  -- PART_RETURN
  ('PART_RETURN','PART_SCAN','Scan returned part','SCAN',            true, 1, 10),
  ('PART_RETURN','ON_SITE_GPS','Arrived on site','GPS',              true, 1, 20),
  ('PART_RETURN','CUSTOMER_OTP','Customer OTP','OTP',                true, 1, 30),
  ('PART_RETURN','WH_RECEIPT','Warehouse receipt scan','SCAN',       true, 1, 40)
ON CONFLICT (wo_type, step_code) DO UPDATE
  SET step_label = EXCLUDED.step_label, step_kind = EXCLUDED.step_kind,
      is_mandatory = EXCLUDED.is_mandatory, min_count = EXCLUDED.min_count,
      sort_order = EXCLUDED.sort_order;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_wo_linked_wo'
  ) THEN
    ALTER TABLE support_work_orders
      ADD CONSTRAINT fk_wo_linked_wo
      FOREIGN KEY (linked_wo_id) REFERENCES support_work_orders(wo_id);
  END IF;
END $$;
