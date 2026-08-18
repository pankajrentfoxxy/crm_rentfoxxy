-- ============================================================
-- Migration 200: Support revamp — SLA calendars, holidays,
--   policies, pause log, customer tier.
--   Number is 200 (not 195) because 192–198 already exist.
-- Idempotent: safe to re-run.
-- ============================================================

ALTER TABLE customers ADD COLUMN IF NOT EXISTS support_tier VARCHAR(20);
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_support_tier_check'
  ) THEN
    ALTER TABLE customers ADD CONSTRAINT customers_support_tier_check
      CHECK (support_tier IS NULL OR support_tier IN ('PLATINUM','GOLD','SILVER','STANDARD'));
  END IF;
END $$;
UPDATE customers SET support_tier = 'STANDARD' WHERE support_tier IS NULL;

CREATE TABLE IF NOT EXISTS support_business_calendars (
  calendar_id   SERIAL PRIMARY KEY,
  code          VARCHAR(40) NOT NULL UNIQUE,
  name          VARCHAR(120) NOT NULL,
  timezone      VARCHAR(60) NOT NULL DEFAULT 'Asia/Kolkata',
  is_always_on  BOOLEAN NOT NULL DEFAULT FALSE,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_calendar_hours (
  hours_id      SERIAL PRIMARY KEY,
  calendar_id   INT NOT NULL REFERENCES support_business_calendars(calendar_id),
  day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  UNIQUE (calendar_id, day_of_week)
);

CREATE TABLE IF NOT EXISTS support_holidays (
  holiday_id    SERIAL PRIMARY KEY,
  calendar_id   INT NOT NULL REFERENCES support_business_calendars(calendar_id) ON DELETE CASCADE,
  holiday_date  DATE NOT NULL,
  name          VARCHAR(120) NOT NULL,
  UNIQUE (calendar_id, holiday_date)
);

CREATE TABLE IF NOT EXISTS support_sla_policies (
  policy_id           SERIAL PRIMARY KEY,
  name                VARCHAR(120) NOT NULL,
  ticket_class        VARCHAR(10)
                        CHECK (ticket_class IS NULL OR ticket_class IN ('INCIDENT','REQUEST','BOTH')),
  priority            SMALLINT CHECK (priority IS NULL OR priority IN (1,2,3,4)),
  support_tier        VARCHAR(20)
                        CHECK (support_tier IS NULL OR support_tier IN ('PLATINUM','GOLD','SILVER','STANDARD')),
  customer_id         INT REFERENCES customers(customer_id),
  calendar_id         INT NOT NULL REFERENCES support_business_calendars(calendar_id),
  response_minutes    INT NOT NULL,
  resolution_minutes  INT NOT NULL,
  specificity         INT NOT NULL DEFAULT 0,
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Phase 1 clock store. Phase 2 copies these columns onto support_tickets_v2.
CREATE TABLE IF NOT EXISTS support_sla_clocks (
  ticket_id              INT PRIMARY KEY,
  policy_id              INT REFERENCES support_sla_policies(policy_id),
  calendar_id            INT REFERENCES support_business_calendars(calendar_id),
  sla_response_due_at    TIMESTAMPTZ,
  sla_resolution_due_at  TIMESTAMPTZ,
  sla_started_at         TIMESTAMPTZ,
  sla_paused_minutes     INT NOT NULL DEFAULT 0,
  sla_paused             BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_sla_pauses (
  pause_id       SERIAL PRIMARY KEY,
  ticket_id      INT NOT NULL,
  reason         VARCHAR(30) NOT NULL
                   CHECK (reason IN (
                     'PENDING_CUSTOMER','PENDING_VENDOR','PENDING_APPROVAL',
                     'PENDING_PART','PENDING_WAREHOUSE'
                   )),
  customer_side  BOOLEAN NOT NULL DEFAULT FALSE,
  note           TEXT,
  paused_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resumed_at     TIMESTAMPTZ,
  paused_by      INT REFERENCES users(user_id),
  resumed_by     INT REFERENCES users(user_id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sla_pauses_ticket ON support_sla_pauses(ticket_id);

INSERT INTO support_business_calendars (code, name, timezone, is_always_on) VALUES
  ('BUSINESS_MON_SAT', 'Business Mon–Sat 09:30–18:30', 'Asia/Kolkata', FALSE),
  ('ALWAYS_ON',        '24×7 wall clock',              'Asia/Kolkata', TRUE)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name, timezone = EXCLUDED.timezone, is_always_on = EXCLUDED.is_always_on;

-- Days 1–6 = Mon–Sat (0 = Sunday)
INSERT INTO support_calendar_hours (calendar_id, day_of_week, start_time, end_time)
SELECT c.calendar_id, d.dow, TIME '09:30', TIME '18:30'
  FROM support_business_calendars c
  CROSS JOIN (VALUES (1),(2),(3),(4),(5),(6)) AS d(dow)
 WHERE c.code = 'BUSINESS_MON_SAT'
ON CONFLICT (calendar_id, day_of_week) DO UPDATE
  SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time;

INSERT INTO support_calendar_hours (calendar_id, day_of_week, start_time, end_time)
SELECT c.calendar_id, d.dow, TIME '00:00', TIME '23:59'
  FROM support_business_calendars c
  CROSS JOIN (VALUES (0),(1),(2),(3),(4),(5),(6)) AS d(dow)
 WHERE c.code = 'ALWAYS_ON'
ON CONFLICT (calendar_id, day_of_week) DO UPDATE
  SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time;

-- FY 26-27 Indian public holidays on BUSINESS_MON_SAT.
-- Operator: review and add company-specific days (founders day, optional regional holidays).
INSERT INTO support_holidays (calendar_id, holiday_date, name)
SELECT c.calendar_id, v.dt, v.nm
  FROM support_business_calendars c
  CROSS JOIN (VALUES
    (DATE '2026-08-15', 'Independence Day'),
    (DATE '2026-10-02', 'Gandhi Jayanti'),
    (DATE '2026-11-08', 'Diwali'),
    (DATE '2027-01-26', 'Republic Day'),
    (DATE '2027-03-03', 'Holi')
  ) AS v(dt, nm)
 WHERE c.code = 'BUSINESS_MON_SAT'
ON CONFLICT (calendar_id, holiday_date) DO UPDATE SET name = EXCLUDED.name;

-- Four default policies (specificity = 0) + Platinum — High (specificity = 10).
-- Default P2 is 2 h / 24 h as required by the Phase 1 preview check.
INSERT INTO support_sla_policies (
  name, ticket_class, priority, support_tier, calendar_id,
  response_minutes, resolution_minutes, specificity
)
SELECT v.name, v.cls, v.pri, v.tier, c.calendar_id, v.resp, v.reso, v.spec
  FROM (VALUES
    ('Default P1 — Critical', 'BOTH', 1, NULL::varchar, 'ALWAYS_ON',        60,   480,  0),
    ('Default P2 — High',     'BOTH', 2, NULL,          'BUSINESS_MON_SAT', 120,  1440, 0),
    ('Default P3 — Moderate', 'BOTH', 3, NULL,          'BUSINESS_MON_SAT', 240,  2880, 0),
    ('Default P4 — Low',      'BOTH', 4, NULL,          'BUSINESS_MON_SAT', 480,  4320, 0),
    ('Platinum — High',       'INCIDENT', 2, 'PLATINUM', 'BUSINESS_MON_SAT', 60,   720,  10)
  ) AS v(name, cls, pri, tier, cal, resp, reso, spec)
  JOIN support_business_calendars c ON c.code = v.cal
WHERE NOT EXISTS (
  SELECT 1 FROM support_sla_policies p
   WHERE p.name = v.name AND p.priority = v.pri
     AND COALESCE(p.support_tier, '') = COALESCE(v.tier, '')
);
