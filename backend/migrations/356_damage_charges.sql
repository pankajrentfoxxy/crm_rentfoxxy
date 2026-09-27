-- 356: damage charges on customer laptops (claude/carret-customers-returns-control.md, DM1).
--
--   reported (technician at a visit / pickup, or the warehouse at receive: part + issue + photos)
--   → priced (warehouse sets each line's price)
--   → proposed (sales / accounts agree it with the customer; the customer is emailed the details)
--   → approved | waived | rejected (accounts)
--   → billed (on the next month's invoice as "Damage charges", or a service order for a sold laptop)

CREATE TABLE IF NOT EXISTS damage_cases (
  id                    SERIAL PRIMARY KEY,
  customer_id           INTEGER NOT NULL,
  serial_id             INTEGER REFERENCES vendor_serial_numbers(serial_id),
  asset_code            VARCHAR(100),
  source                VARCHAR(30) NOT NULL
                          CHECK (source IN ('technician_visit', 'repair_pickup', 'return_pickup', 'warehouse_receive')),
  support_ticket_id     INTEGER,
  support_ticket_item_id INTEGER,
  return_dc_number      VARCHAR(50),
  status                VARCHAR(20) NOT NULL DEFAULT 'reported'
                          CHECK (status IN ('reported', 'priced', 'proposed', 'approved', 'waived', 'rejected', 'billed', 'cancelled')),
  notes                 TEXT,
  reported_by           INTEGER,
  reported_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  priced_by             INTEGER,
  priced_at             TIMESTAMPTZ,
  proposed_by           INTEGER,
  proposed_at           TIMESTAMPTZ,
  proposal_note         TEXT,
  email_to              TEXT,
  email_sent_at         TIMESTAMPTZ,
  email_error           TEXT,
  decided_by            INTEGER,
  decided_at            TIMESTAMPTZ,
  decision_note         TEXT,
  approved_amount       NUMERIC(12,2),
  charge_line_id        INTEGER,
  service_charge_id     INTEGER,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_damage_cases_status ON damage_cases(status);
CREATE INDEX IF NOT EXISTS idx_damage_cases_customer ON damage_cases(customer_id);
CREATE INDEX IF NOT EXISTS idx_damage_cases_ticket ON damage_cases(support_ticket_id);

CREATE TABLE IF NOT EXISTS damage_case_lines (
  id             SERIAL PRIMARY KEY,
  case_id        INTEGER NOT NULL REFERENCES damage_cases(id) ON DELETE CASCADE,
  part_id        INTEGER,
  part_name      TEXT,
  damage_id      INTEGER,
  issue          TEXT NOT NULL,
  photos         JSONB NOT NULL DEFAULT '[]'::jsonb,
  quantity       INTEGER NOT NULL DEFAULT 1,
  price          NUMERIC(12,2),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_damage_case_lines_case ON damage_case_lines(case_id);

INSERT INTO permission_sections (section, description, sort_order) VALUES
  ('damage_charges', 'Support — damage charges (report, price, propose)', 321)
ON CONFLICT (section) DO NOTHING;

-- Never overwrite existing grants.
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete) VALUES
  ('super_admin',   'damage_charges', true, true, true, true),
  ('admin',         'damage_charges', true, true, true, false),
  ('manager',       'damage_charges', true, true, true, false),
  ('accounts',      'damage_charges', true, false, true, false),
  ('sales',         'damage_charges', true, false, true, false),
  ('warehouse',     'damage_charges', true, true, true, false),
  ('support_lead',  'damage_charges', true, true, false, false),
  ('support_tech',  'damage_charges', true, true, false, false),
  ('floor_manager', 'damage_charges', true, true, false, false)
ON CONFLICT (role, section) DO NOTHING;
