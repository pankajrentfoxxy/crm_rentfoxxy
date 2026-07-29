-- 178: Unified spare-part tracking.
--
-- part_instances.prt_id becomes the canonical, QR-scannable Part ID for every
-- physical unit. This migration links the procurement registry
-- (vendor_serial_numbers) to it, adds an append-only movement ledger so
-- received/installed/returned counts are answerable by date and category, and
-- lets a removed defective part be taken back into stock as its own unit.

-- ---------------------------------------------------------------------------
-- 1. part_instances: provenance, procurement link, defective origin, labels
-- ---------------------------------------------------------------------------
ALTER TABLE part_instances
  ADD COLUMN IF NOT EXISTS vendor_serial_id       INT REFERENCES vendor_serial_numbers(serial_id),
  ADD COLUMN IF NOT EXISTS asset_code             VARCHAR(64),
  ADD COLUMN IF NOT EXISTS vendor_id              INT,
  ADD COLUMN IF NOT EXISTS spo_line_index         INT,
  ADD COLUMN IF NOT EXISTS source                 VARCHAR(24) NOT NULL DEFAULT 'purchase',
  ADD COLUMN IF NOT EXISTS origin_request_id      INT,
  ADD COLUMN IF NOT EXISTS removed_from_ttspl_id  VARCHAR(50),
  ADD COLUMN IF NOT EXISTS removed_from_ticket_id INT,
  ADD COLUMN IF NOT EXISTS label_print_count      INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS label_last_printed_at  TIMESTAMPTZ;

ALTER TABLE part_instances DROP CONSTRAINT IF EXISTS part_instances_source_check;
ALTER TABLE part_instances
  ADD CONSTRAINT part_instances_source_check
  CHECK (source IN ('purchase', 'defective_return', 'manual', 'legacy'));

CREATE INDEX IF NOT EXISTS idx_part_instances_vendor_serial ON part_instances (vendor_serial_id);
CREATE INDEX IF NOT EXISTS idx_part_instances_asset_code    ON part_instances (asset_code);
CREATE INDEX IF NOT EXISTS idx_part_instances_source        ON part_instances (source);
CREATE INDEX IF NOT EXISTS idx_part_instances_received_at   ON part_instances (received_at);
CREATE INDEX IF NOT EXISTS idx_part_instances_installed_at  ON part_instances (installed_at);

-- ---------------------------------------------------------------------------
-- 2. Procurement registry points back at the canonical unit
-- ---------------------------------------------------------------------------
ALTER TABLE vendor_serial_numbers
  ADD COLUMN IF NOT EXISTS part_instance_id INT REFERENCES part_instances(instance_id);

CREATE INDEX IF NOT EXISTS idx_vsn_part_instance ON vendor_serial_numbers (part_instance_id);

-- ---------------------------------------------------------------------------
-- 3. Append-only movement ledger
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS part_movements (
  movement_id    BIGSERIAL PRIMARY KEY,
  movement_type  VARCHAR(30) NOT NULL,
  part_id        INT NOT NULL REFERENCES parts(part_id),
  instance_id    INT REFERENCES part_instances(instance_id) ON DELETE SET NULL,
  prt_id         VARCHAR(30),
  serial_number  VARCHAR(255),
  category       VARCHAR(100),
  part_name      VARCHAR(255),
  quantity       INT NOT NULL DEFAULT 1,
  unit_cost      NUMERIC(12,2) NOT NULL DEFAULT 0,
  request_id     INT,
  ticket_id      INT,
  ttspl_id       VARCHAR(50),
  spo_id         INT,
  grn_id         INT,
  vendor_id      INT,
  is_upgrade     BOOLEAN NOT NULL DEFAULT FALSE,
  part_condition VARCHAR(30),
  notes          TEXT,
  actor_user_id  INT,
  actor_name     VARCHAR(255),
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE part_movements DROP CONSTRAINT IF EXISTS part_movements_type_check;
ALTER TABLE part_movements
  ADD CONSTRAINT part_movements_type_check
  CHECK (movement_type IN (
    'received', 'reserved', 'unreserved', 'installed',
    'returned_defective', 'returned_good', 'adjusted', 'discarded'
  ));

CREATE INDEX IF NOT EXISTS idx_part_movements_occurred   ON part_movements (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_part_movements_type_day   ON part_movements (movement_type, occurred_at);
CREATE INDEX IF NOT EXISTS idx_part_movements_part       ON part_movements (part_id);
CREATE INDEX IF NOT EXISTS idx_part_movements_category   ON part_movements (category);
CREATE INDEX IF NOT EXISTS idx_part_movements_ticket     ON part_movements (ticket_id);
CREATE INDEX IF NOT EXISTS idx_part_movements_instance   ON part_movements (instance_id);
CREATE INDEX IF NOT EXISTS idx_part_movements_ttspl      ON part_movements (ttspl_id);

-- ---------------------------------------------------------------------------
-- 4. Old / defective part declared by inventory at approval time
-- ---------------------------------------------------------------------------
ALTER TABLE part_requests
  ADD COLUMN IF NOT EXISTS old_part_expected     VARCHAR(16),
  ADD COLUMN IF NOT EXISTS old_part_category     VARCHAR(100),
  ADD COLUMN IF NOT EXISTS old_part_part_id      INT REFERENCES parts(part_id),
  ADD COLUMN IF NOT EXISTS old_part_name         VARCHAR(255),
  ADD COLUMN IF NOT EXISTS old_part_instance_id  INT REFERENCES part_instances(instance_id);

ALTER TABLE part_requests DROP CONSTRAINT IF EXISTS part_requests_old_part_expected_check;
ALTER TABLE part_requests
  ADD CONSTRAINT part_requests_old_part_expected_check
  CHECK (old_part_expected IS NULL OR old_part_expected IN ('yes', 'not_available', 'unknown'));

-- ---------------------------------------------------------------------------
-- 5. Backfill
-- ---------------------------------------------------------------------------

-- Units that arrived on a spare PO are purchases; anything already in the table
-- without one predates this migration. Guarded on an empty ledger so re-running
-- the migration cannot relabel units created after it first ran.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM part_movements) THEN
    UPDATE part_instances SET source = 'legacy' WHERE spo_id IS NULL AND source = 'purchase';
  END IF;
END $$;

-- Match existing instances to their procurement serial row where the pairing is
-- unambiguous (same spare PO, same physical serial).
WITH pairs AS (
  SELECT DISTINCT ON (pi.instance_id) pi.instance_id, vsn.serial_id
    FROM part_instances pi
    JOIN vendor_serial_numbers vsn
      ON vsn.spo_id = pi.spo_id
     AND vsn.deleted_at IS NULL
     AND LOWER(vsn.serial_number) = LOWER(pi.serial_number)
   WHERE pi.vendor_serial_id IS NULL
     AND pi.spo_id IS NOT NULL
     AND pi.serial_number IS NOT NULL
   ORDER BY pi.instance_id, vsn.serial_id
)
UPDATE part_instances pi
   SET vendor_serial_id = pairs.serial_id
  FROM pairs
 WHERE pi.instance_id = pairs.instance_id;

UPDATE part_instances pi
   SET asset_code = vsn.inventory_asset_code
  FROM vendor_serial_numbers vsn
 WHERE pi.vendor_serial_id = vsn.serial_id
   AND pi.asset_code IS NULL
   AND vsn.inventory_asset_code IS NOT NULL;

UPDATE vendor_serial_numbers vsn
   SET part_instance_id = pi.instance_id
  FROM part_instances pi
 WHERE pi.vendor_serial_id = vsn.serial_id
   AND vsn.part_instance_id IS NULL;

-- Seed the ledger so the dashboard has history from day one.
INSERT INTO part_movements
  (movement_type, part_id, instance_id, prt_id, serial_number, category, part_name,
   quantity, unit_cost, spo_id, grn_id, occurred_at, notes)
SELECT 'received', pi.part_id, pi.instance_id, pi.prt_id, pi.serial_number,
       p.category, p.part_name, 1, COALESCE(pi.unit_cost, 0), pi.spo_id, pi.grn_id,
       COALESCE(pi.received_at, pi.created_at, NOW()),
       'Backfilled from existing part_instances'
  FROM part_instances pi
  JOIN parts p ON p.part_id = pi.part_id
 WHERE NOT EXISTS (
   SELECT 1 FROM part_movements m
    WHERE m.instance_id = pi.instance_id AND m.movement_type = 'received'
 );

INSERT INTO part_movements
  (movement_type, part_id, instance_id, prt_id, serial_number, category, part_name,
   quantity, unit_cost, ticket_id, ttspl_id, occurred_at, notes)
SELECT 'installed', pi.part_id, pi.instance_id, pi.prt_id, pi.serial_number,
       p.category, p.part_name, 1, COALESCE(pi.unit_cost, 0),
       pi.installed_ticket_id, pi.installed_ttspl_id, pi.installed_at,
       'Backfilled from existing part_instances'
  FROM part_instances pi
  JOIN parts p ON p.part_id = pi.part_id
 WHERE pi.status = 'installed'
   AND pi.installed_at IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM part_movements m
      WHERE m.instance_id = pi.instance_id AND m.movement_type = 'installed'
   );
