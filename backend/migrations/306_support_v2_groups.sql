-- ============================================================
-- Migration 202: Support revamp — groups, zones, skills, shifts,
--   leaves, approvals, technician identity link.
--   Number is 202 (not 197) because 196–200 already exist.
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS support_zones (
  zone_id     SERIAL PRIMARY KEY,
  code        VARCHAR(20) NOT NULL UNIQUE,
  name        VARCHAR(80) NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS support_zone_pincodes (
  range_id      SERIAL PRIMARY KEY,
  zone_id       INT NOT NULL REFERENCES support_zones(zone_id) ON DELETE CASCADE,
  pincode_from  VARCHAR(6) NOT NULL,
  pincode_to    VARCHAR(6) NOT NULL,
  UNIQUE (zone_id, pincode_from, pincode_to)
);

CREATE TABLE IF NOT EXISTS support_assignment_groups (
  group_id    SERIAL PRIMARY KEY,
  name        VARCHAR(80) NOT NULL UNIQUE,
  group_type  VARCHAR(20) NOT NULL
                CHECK (group_type IN ('FIELD','REMOTE','WAREHOUSE','REPAIR')),
  zone_id     INT REFERENCES support_zones(zone_id),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  demo_seed   BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS support_group_members (
  group_id  INT NOT NULL REFERENCES support_assignment_groups(group_id) ON DELETE CASCADE,
  user_id   INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  is_lead   BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS support_skills (
  skill_id  SERIAL PRIMARY KEY,
  code      VARCHAR(40) NOT NULL UNIQUE,
  name      VARCHAR(80) NOT NULL
);

CREATE TABLE IF NOT EXISTS user_skills (
  user_id   INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  skill_id  INT NOT NULL REFERENCES support_skills(skill_id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, skill_id)
);

CREATE TABLE IF NOT EXISTS user_shifts (
  shift_id          SERIAL PRIMARY KEY,
  user_id           INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  day_of_week       SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time        TIME NOT NULL,
  end_time          TIME NOT NULL,
  max_jobs_per_day  INT NOT NULL DEFAULT 6,
  UNIQUE (user_id, day_of_week)
);

CREATE TABLE IF NOT EXISTS user_leaves (
  leave_id    SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  leave_date  DATE NOT NULL,
  reason      VARCHAR(200),
  UNIQUE (user_id, leave_date)
);

CREATE TABLE IF NOT EXISTS support_approvals (
  approval_id       SERIAL PRIMARY KEY,
  ticket_id         INT REFERENCES support_tickets_v2(ticket_id) ON DELETE CASCADE,
  line_id           INT REFERENCES support_ticket_assets(line_id) ON DELETE SET NULL,
  wo_id             INT REFERENCES support_work_orders(wo_id) ON DELETE SET NULL,
  approval_type     VARCHAR(40) NOT NULL
                      CHECK (approval_type IN (
                        'REPLACEMENT','DAMAGE_CHARGE','CHARGEABLE_PART','PART_VALUE',
                        'EARLY_TERMINATION','RATE_CHANGE','SLA_WAIVER','PRIORITY_OVERRIDE'
                      )),
  status            VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','APPROVED','REJECTED','WAIVED')),
  amount            NUMERIC(12,2),
  label             VARCHAR(200),
  requested_by      INT REFERENCES users(user_id),
  decided_by        INT REFERENCES users(user_id),
  decided_at        TIMESTAMPTZ,
  decision_reason   TEXT,
  customer_side     BOOLEAN NOT NULL DEFAULT FALSE,
  demo_seed         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sup_approvals_ticket ON support_approvals(ticket_id);
CREATE INDEX IF NOT EXISTS idx_sup_approvals_status ON support_approvals(status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_stk2_assignment_group'
  ) THEN
    ALTER TABLE support_tickets_v2
      ADD CONSTRAINT fk_stk2_assignment_group
      FOREIGN KEY (assignment_group_id) REFERENCES support_assignment_groups(group_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_wo_assignment_group'
  ) THEN
    ALTER TABLE support_work_orders
      ADD CONSTRAINT fk_wo_assignment_group
      FOREIGN KEY (assignment_group_id) REFERENCES support_assignment_groups(group_id);
  END IF;
END $$;

-- Skills
INSERT INTO support_skills (code, name) VALUES
  ('FIELD_SWAP',      'Field swap'),
  ('SOFTWARE_L1',     'Software L1'),
  ('SOFTWARE_L2',     'Software L2'),
  ('HARDWARE_BASIC',  'Hardware basic'),
  ('CHIP_LEVEL',      'Chip-level repair'),
  ('NETWORK',         'Network'),
  ('DATA_MIGRATION',  'Data migration')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

-- Zones
INSERT INTO support_zones (code, name) VALUES
  ('NCR',        'NCR'),
  ('BENGALURU',  'Bengaluru'),
  ('MUMBAI',     'Mumbai'),
  ('PUNE',       'Pune'),
  ('HYDERABAD',  'Hyderabad'),
  ('KOLKATA',    'Kolkata'),
  ('CHENNAI',    'Chennai')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO support_zone_pincodes (zone_id, pincode_from, pincode_to)
SELECT z.zone_id, r.pincode_from, r.pincode_to
  FROM support_zones z
  JOIN (VALUES
    ('NCR',       '110001', '110096'),
    ('NCR',       '122001', '122018'),
    ('NCR',       '201301', '201318'),
    ('NCR',       '121001', '121010'),
    ('BENGALURU', '560001', '560103'),
    ('MUMBAI',    '400001', '400104'),
    ('PUNE',      '411001', '411062'),
    ('HYDERABAD', '500001', '500098'),
    ('KOLKATA',   '700001', '700107'),
    ('CHENNAI',   '600001', '600119')
  ) AS r(code, pincode_from, pincode_to) ON r.code = z.code
ON CONFLICT (zone_id, pincode_from, pincode_to) DO NOTHING;

-- Groups
INSERT INTO support_assignment_groups (name, group_type, zone_id)
SELECT v.name, v.group_type, z.zone_id
  FROM (VALUES
    ('NCR Field',          'FIELD',     'NCR'),
    ('Bengaluru Field',    'FIELD',     'BENGALURU'),
    ('Mumbai Field',       'FIELD',     'MUMBAI'),
    ('Pune Field',         'FIELD',     'PUNE'),
    ('Hyderabad Field',    'FIELD',     'HYDERABAD'),
    ('Remote L1',          'REMOTE',    NULL),
    ('Remote L2',          'REMOTE',    NULL),
    ('Warehouse Gurugram', 'WAREHOUSE', 'NCR'),
    ('Chip-level Repair',  'REPAIR',    'NCR')
  ) AS v(name, group_type, zone_code)
  LEFT JOIN support_zones z ON z.code = v.zone_code
ON CONFLICT (name) DO UPDATE
  SET group_type = EXCLUDED.group_type, zone_id = EXCLUDED.zone_id;

-- Default Mon–Sat 09:30–18:30 shift for every support_tech (0=Sun)
INSERT INTO user_shifts (user_id, day_of_week, start_time, end_time, max_jobs_per_day)
SELECT u.user_id, d.dow, TIME '09:30', TIME '18:30', 6
  FROM users u
  CROSS JOIN (VALUES (1),(2),(3),(4),(5),(6)) AS d(dow)
 WHERE u.role = 'support_tech'
ON CONFLICT (user_id, day_of_week) DO NOTHING;

-- Identity fix (D21/D22): user_id already exists on delivery_technicians (048).
ALTER TABLE delivery_technicians ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(user_id);

UPDATE delivery_technicians dt
   SET user_id = u.user_id
  FROM users u
 WHERE dt.user_id IS NULL
   AND dt.email IS NOT NULL
   AND lower(dt.email) = lower(u.email);

UPDATE delivery_technicians dt
   SET user_id = u.user_id
  FROM users u
 WHERE dt.user_id IS NULL
   AND dt.phone IS NOT NULL
   AND u.mobile_no IS NOT NULL
   AND regexp_replace(dt.phone, '\D', '', 'g') = regexp_replace(u.mobile_no, '\D', '', 'g')
   AND length(regexp_replace(dt.phone, '\D', '', 'g')) >= 10;

CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_tech_user
  ON delivery_technicians(user_id) WHERE user_id IS NOT NULL;
