-- Migration: 189_vendor_part_repair_return.sql
-- Vendor Parts Repair & Return — extend part_instances / part_movements enums,
-- add item_domain on VRDC header, parallel part items table, and instance DC link.
-- Preserves all live CHECK values from Step 0 (as of 2026-08-12).

-- 1. New part_instances statuses for the vendor repair/return lifecycle.
ALTER TABLE part_instances DROP CONSTRAINT IF EXISTS part_instances_status_check;
ALTER TABLE part_instances ADD CONSTRAINT part_instances_status_check
  CHECK (status IN (
    'in_stock', 'reserved', 'installed', 'defective', 'returned', 'discarded', 'sold',
    'with_technician',
    'in_transit',
    'with_vendor_repair',
    'qc_pending'
  ));

-- 2. New movement types for the ledger.
ALTER TABLE part_movements DROP CONSTRAINT IF EXISTS part_movements_type_check;
ALTER TABLE part_movements ADD CONSTRAINT part_movements_type_check
  CHECK (movement_type IN (
    'received', 'reserved', 'unreserved', 'installed', 'returned_defective', 'returned_good',
    'adjusted', 'discarded',
    'sent_to_vendor_repair',
    'received_from_vendor_repair'
  ));

-- 3. Restrict an existing VRDC header to a single item domain (laptops OR parts).
ALTER TABLE vendor_repair_delivery_challans
  ADD COLUMN IF NOT EXISTS item_domain VARCHAR(16) NOT NULL DEFAULT 'laptop';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'vendor_repair_delivery_challans_item_domain_check'
  ) THEN
    ALTER TABLE vendor_repair_delivery_challans
      ADD CONSTRAINT vendor_repair_delivery_challans_item_domain_check
      CHECK (item_domain IN ('laptop', 'part'));
  END IF;
END $$;

-- 4. Parallel items table for parts (mirrors vendor_repair_dc_items shape/status ladder).
CREATE TABLE IF NOT EXISTS vendor_repair_dc_part_items (
  id                          SERIAL PRIMARY KEY,
  dc_number                   VARCHAR(64) NOT NULL
                              REFERENCES vendor_repair_delivery_challans(dc_number) ON DELETE CASCADE,
  instance_id                 INT NOT NULL REFERENCES part_instances(instance_id) ON DELETE CASCADE,
  prt_id                      VARCHAR(30),
  part_id                     INT REFERENCES parts(part_id),
  part_name                   VARCHAR(255),
  serial_number               VARCHAR(255),
  item_remarks                TEXT,
  item_status                 VARCHAR(32) NOT NULL DEFAULT 'draft',
  price                       NUMERIC(12,2),
  hsn_code                    VARCHAR(12),
  receive_mode                VARCHAR(32),
  receive_dc_number           VARCHAR(64),
  replacement_dc_number       VARCHAR(64),
  replacement_instance_id     INT REFERENCES part_instances(instance_id),
  receive_verified_serial     VARCHAR(128),
  receive_wh_esign_url        TEXT,
  receive_wh_signer_name      VARCHAR(255),
  receive_wh_signed_at        TIMESTAMPTZ,
  returned_at                 TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (dc_number, instance_id)
);

CREATE INDEX IF NOT EXISTS idx_vrdc_part_items_instance
  ON vendor_repair_dc_part_items(instance_id);
CREATE INDEX IF NOT EXISTS idx_vrdc_part_items_status
  ON vendor_repair_dc_part_items(dc_number, item_status);

-- 5. Link part_instances back to its active repair DC.
ALTER TABLE part_instances
  ADD COLUMN IF NOT EXISTS vendor_repair_dc_number VARCHAR(64);

COMMENT ON COLUMN vendor_repair_delivery_challans.item_domain IS
  'laptop = vendor_repair_dc_items; part = vendor_repair_dc_part_items. One domain per DC.';
COMMENT ON TABLE vendor_repair_dc_part_items IS
  'Part-instance line items for vendor repair/return DCs (item_domain=part).';
