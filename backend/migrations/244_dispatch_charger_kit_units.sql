-- Dispatch kit is two products: laptop charger/adapter + power cable.

CREATE TABLE IF NOT EXISTS dispatch_charger_units (
  unit_id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES dispatch_charger_requests(request_id) ON DELETE CASCADE,
  kit_role VARCHAR(20) NOT NULL CHECK (kit_role IN ('adapter', 'cable')),
  part_id INTEGER,
  part_instance_id INTEGER,
  prt_id VARCHAR(80),
  asset_code VARCHAR(80),
  serial_number VARCHAR(128),
  part_name VARCHAR(200),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (request_id, kit_role)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dcu_instance_active
  ON dispatch_charger_units (part_instance_id)
  WHERE part_instance_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dcu_request ON dispatch_charger_units (request_id);

ALTER TABLE dispatch_charger_requests
  ADD COLUMN IF NOT EXISTS qc_cable_scanned VARCHAR(128);

ALTER TABLE dispatch_charger_return_scans
  ADD COLUMN IF NOT EXISTS cable_scanned VARCHAR(128);

-- Backfill any single-unit handover already recorded on the request.
INSERT INTO dispatch_charger_units (
  request_id, kit_role, part_id, part_instance_id, prt_id, asset_code, serial_number, part_name
)
SELECT
  request_id,
  CASE
    WHEN LOWER(COALESCE(charger_part_name, '')) ~ '(cable|cord)' THEN 'cable'
    ELSE 'adapter'
  END,
  part_id,
  part_instance_id,
  prt_id,
  charger_asset_code,
  charger_serial,
  charger_part_name
FROM dispatch_charger_requests
WHERE part_instance_id IS NOT NULL
ON CONFLICT (request_id, kit_role) DO NOTHING;
