-- 262_loan_laptop_workflow.sql
-- Loan / temporary replacement laptop issued to a rental customer while their
-- own laptop is away on a support repair pickup.
--
--   * No Sales Order is ever created. The laptop goes out on its own Loan DC
--     (delivery_challan_lines.dc_purpose = 'loan', LDC/yy-yy/NNNN) and sits in
--     the non-billable inventory state 'on_loan' (services/inventoryStateMachine).
--   * When the repair is done the customer either takes the original back
--     (loan laptop returns on a pickup Return DC, dc_purpose = 'loan_return') or
--     keeps the loan laptop, which Accounts converts to a rental at an approved
--     price from an agreed effective date.
--   * Which loan laptops may be offered is decided by configurable rules
--     (loan_replacement_policy_rules + loan_cpu_tiers), not code.
--
-- Not replayed by any ensure*Schema() — runs once via scripts/run-all-migrations.js.
-- Additive and idempotent: existing grants are never overwritten.

CREATE TABLE IF NOT EXISTS loan_cpu_tiers (
  cpu_family  VARCHAR(30) PRIMARY KEY,   -- grnConfigService.cpuType(): i5, ryzen7, ultra5, m2 ...
  tier_rank   INTEGER NOT NULL,
  label       VARCHAR(60),
  updated_by  INTEGER,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO loan_cpu_tiers (cpu_family, tier_rank, label) VALUES
  ('celeron', 10, 'Intel Celeron'),
  ('pentium', 10, 'Intel Pentium'),
  ('i3',      30, 'Intel Core i3'),
  ('ryzen3',  30, 'AMD Ryzen 3'),
  ('i5',      50, 'Intel Core i5'),
  ('ryzen5',  50, 'AMD Ryzen 5'),
  ('ultra5',  55, 'Intel Core Ultra 5'),
  ('m1',      55, 'Apple M1'),
  ('m2',      60, 'Apple M2'),
  ('i7',      70, 'Intel Core i7'),
  ('ryzen7',  70, 'AMD Ryzen 7'),
  ('ultra7',  75, 'Intel Core Ultra 7'),
  ('m3',      70, 'Apple M3'),
  ('m4',      75, 'Apple M4'),
  ('m5',      80, 'Apple M5'),
  ('i9',      90, 'Intel Core i9'),
  ('ryzen9',  90, 'AMD Ryzen 9'),
  ('ultra9',  95, 'Intel Core Ultra 9'),
  ('xeon',    90, 'Intel Xeon')
ON CONFLICT (cpu_family) DO NOTHING;

-- First matching active rule (lowest priority number) decides. A NULL column
-- means "any". tier_relation compares loan tier with the original's tier;
-- gen_uplift_* bound (loan generation - original generation).
CREATE TABLE IF NOT EXISTS loan_replacement_policy_rules (
  id                   SERIAL PRIMARY KEY,
  name                 VARCHAR(160) NOT NULL,
  priority             INTEGER NOT NULL DEFAULT 100,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  original_cpu_family  VARCHAR(30),
  loan_cpu_family      VARCHAR(30),
  original_gen_min     INTEGER,
  original_gen_max     INTEGER,
  loan_gen_min         INTEGER,
  loan_gen_max         INTEGER,
  tier_relation        VARCHAR(20) NOT NULL DEFAULT 'any'
                         CHECK (tier_relation IN ('any', 'same', 'higher', 'lower', 'same_or_lower')),
  gen_uplift_min       INTEGER,
  gen_uplift_max       INTEGER,
  decision             VARCHAR(20) NOT NULL
                         CHECK (decision IN ('allowed', 'approval_required', 'not_allowed')),
  notes                TEXT,
  created_by           INTEGER,
  updated_by           INTEGER,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_loan_policy_rules_active
  ON loan_replacement_policy_rules (is_active, priority);

-- Seed only into an empty table so edits made in the UI are never re-added.
INSERT INTO loan_replacement_policy_rules
  (name, priority, tier_relation, loan_gen_min, gen_uplift_min, gen_uplift_max, decision, notes)
SELECT v.name, v.priority, v.tier_relation, v.loan_gen_min, v.gen_uplift_min, v.gen_uplift_max, v.decision, v.notes
  FROM (VALUES
    ('Higher processor tier (e.g. i5 → i7) needs Accounts approval', 10, 'higher', NULL::int, NULL::int, NULL::int,
     'approval_required', 'Upgrade to a higher performance tier.'),
    ('13th Gen or newer needs Accounts approval', 20, 'any', 13, NULL, NULL,
     'approval_required', 'Latest-generation stock is reserved for new rentals.'),
    ('Same tier, up to 2 generations newer (e.g. i5 10th → i5 11th/12th)', 30, 'same', NULL, 0, 2,
     'allowed', NULL),
    ('Same tier, 3 or more generations newer needs Accounts approval', 40, 'same', NULL, 3, NULL,
     'approval_required', NULL),
    ('Same tier, older generation', 50, 'same', NULL, NULL, -1,
     'allowed', 'Temporary downgrade while the original is repaired.'),
    ('Lower processor tier', 60, 'lower', NULL, NULL, NULL,
     'allowed', 'Temporary downgrade while the original is repaired.'),
    ('Fallback — configuration not recognised needs Accounts approval', 1000, 'any', NULL, NULL, NULL,
     'approval_required', 'Catches laptops whose processor or generation could not be read.')
  ) AS v(name, priority, tier_relation, loan_gen_min, gen_uplift_min, gen_uplift_max, decision, notes)
 WHERE NOT EXISTS (SELECT 1 FROM loan_replacement_policy_rules);

CREATE TABLE IF NOT EXISTS support_loan_requests (
  id                          SERIAL PRIMARY KEY,
  request_number              VARCHAR(40) NOT NULL UNIQUE,     -- LNR/26-27/0001
  status                      VARCHAR(40) NOT NULL DEFAULT 'requested'
                                CHECK (status IN (
                                  'requested', 'pending_approval', 'approved', 'rejected',
                                  'dc_generated', 'dispatched', 'loan_active',
                                  'repair_completed', 'decision_pending',
                                  'return_in_progress', 'returned',
                                  'conversion_pending_approval', 'converted',
                                  'cancelled')),

  -- Repair context (auto-linked from the ticket)
  ticket_id                   INTEGER NOT NULL REFERENCES support_tickets(id),
  pickup_item_id              INTEGER NOT NULL REFERENCES support_ticket_items(id),
  customer_id                 INTEGER NOT NULL,
  customer_name               VARCHAR(255),
  original_serial_id          INTEGER REFERENCES vendor_serial_numbers(serial_id),
  original_ttspl_id           VARCHAR(60),
  original_serial_number      VARCHAR(120),
  original_spec               JSONB,                           -- brand/model/processor/generation/ram/storage
  original_rent_monthly_rate  NUMERIC(12,2),
  original_sales_order_number VARCHAR(60),
  original_dc_number          VARCHAR(60),

  -- Loan laptop
  loan_serial_id              INTEGER NOT NULL REFERENCES vendor_serial_numbers(serial_id),
  loan_ttspl_id               VARCHAR(60),
  loan_serial_number          VARCHAR(120),
  loan_spec                   JSONB,

  delivery_address            JSONB,
  contact_name                VARCHAR(160),
  contact_phone               VARCHAR(40),
  request_remarks             TEXT,

  -- Replacement policy outcome (snapshot at request time)
  policy_rule_id              INTEGER,
  policy_rule_name            VARCHAR(160),
  policy_decision             VARCHAR(20),
  policy_detail               JSONB,
  approval_required           BOOLEAN NOT NULL DEFAULT FALSE,

  -- Accounts approval of the loan (and the price used if it is ever kept)
  approved_rent_monthly_rate  NUMERIC(12,2),
  approved_by                 INTEGER,
  approved_at                 TIMESTAMPTZ,
  approval_remarks            TEXT,
  rejected_by                 INTEGER,
  rejected_at                 TIMESTAMPTZ,
  rejection_reason            TEXT,

  -- Loan DC + handover
  loan_dc_number              VARCHAR(60),
  loan_dc_created_at          TIMESTAMPTZ,
  loan_dc_created_by          INTEGER,
  dispatch_mode               VARCHAR(30),
  dispatched_at               TIMESTAMPTZ,
  delivered_at                TIMESTAMPTZ,
  handover_detail             JSONB,

  -- Repair completion + customer decision
  repair_completed_at         TIMESTAMPTZ,
  repair_completed_by         INTEGER,
  customer_decision           VARCHAR(20) CHECK (customer_decision IN ('return_loan', 'keep_loan')),
  decision_recorded_by        INTEGER,
  decision_recorded_at        TIMESTAMPTZ,
  customer_confirmation       JSONB,                           -- method / confirmed_by / reference / at

  -- Option A: loan laptop comes back
  loan_return_ticket_id       INTEGER,
  loan_return_pickup_item_id  INTEGER,
  loan_return_dc_number       VARCHAR(60),
  original_service_dc_number  VARCHAR(60),
  loan_returned_at            TIMESTAMPTZ,

  -- Option B: customer keeps the loan laptop
  proposed_effective_date     DATE,
  proposed_rent_monthly_rate  NUMERIC(12,2),
  conversion_approved_by      INTEGER,
  conversion_approved_at      TIMESTAMPTZ,
  conversion_rent_monthly_rate NUMERIC(12,2),
  conversion_effective_date   DATE,
  retroactive_authorized      BOOLEAN NOT NULL DEFAULT FALSE,
  retroactive_reason          TEXT,
  original_rent_end_date      DATE,                            -- effective date - 1
  original_credit_note_id     INTEGER,
  converted_at                TIMESTAMPTZ,

  cancelled_by                INTEGER,
  cancelled_at                TIMESTAMPTZ,
  cancellation_reason         TEXT,

  created_by                  INTEGER,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_loan_requests_ticket   ON support_loan_requests (ticket_id);
CREATE INDEX IF NOT EXISTS idx_loan_requests_customer ON support_loan_requests (customer_id);
CREATE INDEX IF NOT EXISTS idx_loan_requests_status   ON support_loan_requests (status);
CREATE INDEX IF NOT EXISTS idx_loan_requests_loan_dc  ON support_loan_requests (loan_dc_number);
CREATE INDEX IF NOT EXISTS idx_loan_requests_return_pickup ON support_loan_requests (loan_return_pickup_item_id);
CREATE INDEX IF NOT EXISTS idx_loan_requests_original ON support_loan_requests (original_serial_id);

-- One live loan per laptop, and one live loan per repair pickup. Terminal
-- states release both so the laptop (or a new pickup) can be loaned again.
CREATE UNIQUE INDEX IF NOT EXISTS uq_loan_requests_active_loan_serial
  ON support_loan_requests (loan_serial_id)
  WHERE status NOT IN ('rejected', 'cancelled', 'returned', 'converted');
CREATE UNIQUE INDEX IF NOT EXISTS uq_loan_requests_active_pickup
  ON support_loan_requests (pickup_item_id)
  WHERE status NOT IN ('rejected', 'cancelled', 'returned');

CREATE TABLE IF NOT EXISTS support_loan_request_events (
  id               SERIAL PRIMARY KEY,
  loan_request_id  INTEGER NOT NULL REFERENCES support_loan_requests(id) ON DELETE CASCADE,
  from_status      VARCHAR(40),
  to_status        VARCHAR(40),
  action           VARCHAR(60) NOT NULL,
  detail           JSONB,
  actor_user_id    INTEGER,
  actor_name       VARCHAR(160),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_loan_request_events_request
  ON support_loan_request_events (loan_request_id, created_at);

-- ── Permissions ─────────────────────────────────────────────────────────────
INSERT INTO permission_sections (section, description, sort_order) VALUES
  ('loan_laptops',         'Loan laptops — request, track and record customer decision', 414),
  ('loan_laptop_approval', 'Loan laptops — Accounts approval of loan and rental price',    415),
  ('loan_laptop_policy',   'Loan laptops — replacement policy rules and CPU tiers',        416)
ON CONFLICT (section) DO NOTHING;

-- Whoever works support tickets works loan requests (technicians excluded:
-- they execute pickups, they do not raise loans). View-only roles such as
-- accounts / dispatch / warehouse inherit view-only.
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT rp.role, 'loan_laptops', rp.can_view, rp.can_create, rp.can_edit, FALSE
  FROM role_permissions rp
 WHERE rp.section = 'support_tickets'
   AND rp.role <> 'support_tech'
   AND (rp.can_view OR rp.can_create OR rp.can_edit)
ON CONFLICT (role, section) DO NOTHING;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete) VALUES
  ('accounts', 'loan_laptop_approval', TRUE, FALSE, TRUE, FALSE),
  ('admin',    'loan_laptop_approval', TRUE, TRUE,  TRUE, FALSE),
  ('manager',  'loan_laptop_approval', TRUE, TRUE,  TRUE, FALSE),
  ('admin',    'loan_laptop_policy',   TRUE, TRUE,  TRUE, TRUE),
  ('manager',  'loan_laptop_policy',   TRUE, TRUE,  TRUE, FALSE),
  ('accounts', 'loan_laptop_policy',   TRUE, FALSE, FALSE, FALSE)
ON CONFLICT (role, section) DO NOTHING;
