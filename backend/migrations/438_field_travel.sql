-- 438: Field technician day and travel (17 Oct 2026).
--
-- A technician starts the day by checking in (an office from the list, or
-- where they are). Every "reached" — a support visit, a pickup, a delivery or
-- a vendor hand-over — is a stop; the road distance from the previous stop
-- (or the check-in) is stored on a leg. Ending the day adds the leg back to
-- the office. Road distance: Google Distance Matrix when GOOGLE_MAPS_API_KEY
-- is set, else OSRM (OpenStreetMap). Additive only.

CREATE TABLE IF NOT EXISTS field_checkin_places (
  place_id   SERIAL PRIMARY KEY,
  name       VARCHAR(120) NOT NULL,
  latitude   NUMERIC(10,7) NOT NULL,
  longitude  NUMERIC(10,7) NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO field_checkin_places (name, latitude, longitude, is_default)
SELECT 'Office — IFFCO Chowk, Gurugram', 28.4721500, 77.0724800, TRUE
 WHERE NOT EXISTS (SELECT 1 FROM field_checkin_places);

CREATE TABLE IF NOT EXISTS field_days (
  day_id         SERIAL PRIMARY KEY,
  user_id        INT NOT NULL,
  day            DATE NOT NULL,
  start_label    TEXT NOT NULL,
  start_lat      NUMERIC(10,7) NOT NULL,
  start_lng      NUMERIC(10,7) NOT NULL,
  start_place_id INT,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  end_label      TEXT,
  end_lat        NUMERIC(10,7),
  end_lng        NUMERIC(10,7),
  ended_at       TIMESTAMPTZ,
  UNIQUE (user_id, day)
);

CREATE TABLE IF NOT EXISTS field_travel_legs (
  leg_id      SERIAL PRIMARY KEY,
  day_id      INT NOT NULL REFERENCES field_days(day_id) ON DELETE CASCADE,
  user_id     INT NOT NULL,
  seq         INT NOT NULL,
  kind        VARCHAR(20) NOT NULL CHECK (kind IN ('visit', 'pickup', 'delivery', 'vendor', 'end')),
  ref         VARCHAR(120),
  label       TEXT,
  from_lat    NUMERIC(10,7) NOT NULL,
  from_lng    NUMERIC(10,7) NOT NULL,
  to_lat      NUMERIC(10,7) NOT NULL,
  to_lng      NUMERIC(10,7) NOT NULL,
  reached_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  road_km     NUMERIC(8,2),
  road_min    NUMERIC(8,1),
  provider    VARCHAR(12),
  status      VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ok', 'failed')),
  error       TEXT,
  UNIQUE (day_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_field_travel_legs_user ON field_travel_legs (user_id, reached_at);

INSERT INTO permission_sections (section, description, sort_order, section_group) VALUES
  ('field_travel', 'Field — technicians'' day travel and tasks (dashboard)', 216, 'support')
ON CONFLICT (section) DO NOTHING;
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete) VALUES
  ('super_admin',  'field_travel', TRUE, TRUE, TRUE, FALSE),
  ('admin',        'field_travel', TRUE, TRUE, TRUE, FALSE),
  ('support_lead', 'field_travel', TRUE, FALSE, FALSE, FALSE),
  ('manager',      'field_travel', TRUE, FALSE, FALSE, FALSE)
ON CONFLICT (role, section) DO NOTHING;
