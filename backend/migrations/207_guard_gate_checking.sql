-- Guard Gate Checking — warehouse inward/outward validation layer.
-- Does not change inventory status. Existing GRN / DC / Support / VRDC remain SoT.

-- 1) Allow the dedicated Guard role on users.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
    CHECK (
      role IN (
        'super_admin',
        'admin',
        'manager',
        'team_member',
        'team_lead',
        'sales',
        'floor_manager',
        'procurement',
        'qc',
        'dispatch',
        'warehouse',
        'accounts',
        'support_lead',
        'support_tech',
        'dispatch_qc',
        'customer',
        'vendor',
        'technician',
        'guard'
      )
    );

INSERT INTO roles (name, display_name, description, is_system_role) VALUES
  ('guard', 'Guard', 'Warehouse gate scanner only — validate inward/outward laptops', false)
ON CONFLICT (name) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      description  = EXCLUDED.description,
      is_system_role = EXCLUDED.is_system_role;

INSERT INTO permission_sections (section, description, sort_order)
VALUES (
  'guard_gate_checking',
  'Guard Gate Checking — scan and validate warehouse inward/outward laptops',
  172
)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('guard',         'guard_gate_checking', true, true, true, false),
  ('warehouse',     'guard_gate_checking', true, true, true, false),
  ('floor_manager', 'guard_gate_checking', true, true, true, false),
  ('dispatch',      'guard_gate_checking', true, true, true, false),
  ('admin',         'guard_gate_checking', true, true, true, false),
  ('super_admin',   'guard_gate_checking', true, true, true, true),
  ('manager',       'guard_gate_checking', true, true, true, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit,
      can_delete = EXCLUDED.can_delete;

-- QR tokens for movement documents (DC / RDC / VRDC / SDC / GRN).
CREATE TABLE IF NOT EXISTS gate_document_tokens (
  token           VARCHAR(64) PRIMARY KEY,
  document_type   VARCHAR(20) NOT NULL,
  document_number VARCHAR(80) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_gate_document_tokens_doc
  ON gate_document_tokens (document_type, document_number);

CREATE INDEX IF NOT EXISTS idx_gate_document_tokens_number
  ON gate_document_tokens (document_number);

-- One open scan session per document + direction (multi-laptop DCs).
CREATE TABLE IF NOT EXISTS gate_scan_sessions (
  session_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction         VARCHAR(16) NOT NULL CHECK (direction IN ('inward', 'outward')),
  source_type       VARCHAR(40) NOT NULL,
  reference_type    VARCHAR(20) NOT NULL,
  reference_number  VARCHAR(80) NOT NULL,
  awb_number        VARCHAR(80),
  expected_count    INTEGER NOT NULL DEFAULT 0,
  allow_partial     BOOLEAN NOT NULL DEFAULT FALSE,
  status            VARCHAR(20) NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'confirmed', 'cancelled')),
  guard_user_id     INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at      TIMESTAMPTZ,
  remarks           TEXT,
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_gate_sessions_open
  ON gate_scan_sessions (direction, reference_type, reference_number)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_gate_sessions_guard
  ON gate_scan_sessions (guard_user_id, created_at DESC);

-- Per-laptop gate scan / audit record.
CREATE TABLE IF NOT EXISTS gate_movements (
  id                  BIGSERIAL PRIMARY KEY,
  session_id          UUID REFERENCES gate_scan_sessions(session_id) ON DELETE SET NULL,
  direction           VARCHAR(16) NOT NULL CHECK (direction IN ('inward', 'outward')),
  source_type         VARCHAR(40),
  reference_type      VARCHAR(20),
  reference_number    VARCHAR(80),
  serial_id           INTEGER REFERENCES vendor_serial_numbers(serial_id) ON DELETE SET NULL,
  ttspl               VARCHAR(64),
  serial_number       VARCHAR(128),
  awb_number          VARCHAR(80),
  guard_user_id       INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  guard_name          VARCHAR(255),
  scan_time           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  validation_result   VARCHAR(16) NOT NULL CHECK (validation_result IN ('valid', 'invalid')),
  validation_message  TEXT,
  confirmed_at        TIMESTAMPTZ,
  remarks             TEXT,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_gate_movements_scan_time
  ON gate_movements (scan_time DESC);

CREATE INDEX IF NOT EXISTS idx_gate_movements_guard
  ON gate_movements (guard_user_id, scan_time DESC);

CREATE INDEX IF NOT EXISTS idx_gate_movements_ref
  ON gate_movements (reference_type, reference_number, direction);

CREATE INDEX IF NOT EXISTS idx_gate_movements_serial
  ON gate_movements (serial_id, direction)
  WHERE serial_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_gate_movements_confirmed_unit
  ON gate_movements (direction, reference_type, reference_number, serial_id)
  WHERE validation_result = 'valid'
    AND confirmed_at IS NOT NULL
    AND serial_id IS NOT NULL;
