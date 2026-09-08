-- Migration: 233_physical_dead_parts.sql
-- Physical / dead parts found in warehouse that do NOT exist in CRM inventory.
-- Separate from part_instances, discarded parts, and scrap challans.

CREATE TABLE IF NOT EXISTS physical_part_inwards (
  inward_id SERIAL PRIMARY KEY,
  inward_number VARCHAR(40) UNIQUE NOT NULL,
  warehouse VARCHAR(200) NOT NULL,
  inward_date DATE NOT NULL,
  inward_reason TEXT NOT NULL,
  remarks TEXT,
  created_by INTEGER,
  created_by_name VARCHAR(200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS physical_part_outwards (
  outward_id SERIAL PRIMARY KEY,
  outward_number VARCHAR(40) UNIQUE NOT NULL,
  receiver_type VARCHAR(40) NOT NULL,
  receiver_name VARCHAR(200) NOT NULL,
  receiver_contact VARCHAR(40),
  outward_date DATE NOT NULL,
  purpose TEXT NOT NULL,
  photo_path TEXT NOT NULL,
  remarks TEXT,
  reference_number VARCHAR(80),
  created_by INTEGER,
  created_by_name VARCHAR(200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS physical_dead_parts (
  part_id SERIAL PRIMARY KEY,
  dp_number VARCHAR(20) UNIQUE NOT NULL,
  inward_id INTEGER NOT NULL REFERENCES physical_part_inwards(inward_id),
  part_name VARCHAR(200) NOT NULL,
  category VARCHAR(80) NOT NULL,
  serial_number VARCHAR(120),
  warehouse VARCHAR(200) NOT NULL,
  condition VARCHAR(40) NOT NULL DEFAULT 'dead',
  inward_photo_path TEXT NOT NULL,
  remarks TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'available',
  outward_id INTEGER REFERENCES physical_part_outwards(outward_id),
  created_by INTEGER,
  created_by_name VARCHAR(200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT physical_dead_parts_status_chk CHECK (status IN ('available', 'out'))
);

CREATE TABLE IF NOT EXISTS physical_part_outward_items (
  id SERIAL PRIMARY KEY,
  outward_id INTEGER NOT NULL REFERENCES physical_part_outwards(outward_id) ON DELETE CASCADE,
  part_id INTEGER NOT NULL UNIQUE REFERENCES physical_dead_parts(part_id),
  dp_number VARCHAR(20) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_physical_dead_parts_status ON physical_dead_parts (status);
CREATE INDEX IF NOT EXISTS idx_physical_dead_parts_inward ON physical_dead_parts (inward_id);
CREATE INDEX IF NOT EXISTS idx_physical_dead_parts_outward ON physical_dead_parts (outward_id);
CREATE INDEX IF NOT EXISTS idx_physical_dead_parts_dp ON physical_dead_parts (dp_number);
CREATE INDEX IF NOT EXISTS idx_physical_part_inwards_date ON physical_part_inwards (inward_date DESC);
CREATE INDEX IF NOT EXISTS idx_physical_part_outwards_date ON physical_part_outwards (outward_date DESC);

INSERT INTO permission_sections (section, description, sort_order)
VALUES
  ('physical_dead_parts', 'Dead / Physical Parts (warehouse found)', 277)
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
SELECT rp.role, 'physical_dead_parts', rp.can_view, rp.can_create, rp.can_edit, rp.can_delete
  FROM role_permissions rp
 WHERE rp.section = 'parts_discarded'
ON CONFLICT (role, section) DO NOTHING;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin',       'physical_dead_parts', true, true, true, false),
  ('manager',     'physical_dead_parts', true, true, true, false),
  ('warehouse',   'physical_dead_parts', true, true, true, false),
  ('super_admin', 'physical_dead_parts', true, true, true, true),
  ('procurement', 'physical_dead_parts', true, true, true, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit,
      can_delete = EXCLUDED.can_delete;

INSERT INTO user_permissions (user_id, section, can_view, can_create, can_edit, can_delete)
SELECT DISTINCT up.user_id, 'physical_dead_parts', true, false, false, false
  FROM user_permissions up
 WHERE up.section IN ('parts_discarded', 'parts_inventory', 'parts_dashboard')
   AND up.can_view = true
ON CONFLICT (user_id, section) DO NOTHING;
