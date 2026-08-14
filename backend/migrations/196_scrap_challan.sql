-- Migration: 196_scrap_challan.sql
-- Discarded parts → Scrap Challan (one-way disposal to scrap buyer/recycler).
-- 'discarded' = flagged dead / awaiting disposal; 'scrapped' = handed over via Scrap Challan.

ALTER TABLE part_instances DROP CONSTRAINT IF EXISTS part_instances_status_check;
ALTER TABLE part_instances ADD CONSTRAINT part_instances_status_check
  CHECK (status IN (
    'in_stock', 'reserved', 'installed', 'defective', 'returned', 'discarded', 'sold',
    'with_technician', 'in_transit', 'with_vendor_repair', 'qc_pending',
    'scrapped'
  ));

ALTER TABLE part_movements DROP CONSTRAINT IF EXISTS part_movements_type_check;
ALTER TABLE part_movements ADD CONSTRAINT part_movements_type_check
  CHECK (movement_type IN (
    'received', 'reserved', 'unreserved', 'installed', 'returned_defective', 'returned_good',
    'adjusted', 'discarded', 'sent_to_vendor_repair', 'received_from_vendor_repair',
    'scrapped'
  ));

CREATE TABLE IF NOT EXISTS scrap_challans (
  id                             SERIAL PRIMARY KEY,
  challan_number                 VARCHAR(64) UNIQUE NOT NULL,
  recipient_vendor_id            INT REFERENCES vendors(vendor_id) ON DELETE SET NULL,
  recipient_name                 VARCHAR(255) NOT NULL,
  recipient_address              TEXT NOT NULL,
  contact_person                 VARCHAR(255),
  contact_mobile                 VARCHAR(50),
  billing_address                TEXT,
  remarks                        TEXT,
  status                         VARCHAR(32) NOT NULL DEFAULT 'draft',
  ship_by                        VARCHAR(20),
  dispatch_mode                  VARCHAR(20),
  courier_name                   VARCHAR(255),
  awb_number                     VARCHAR(128),
  courier_tracking_url           TEXT,
  porter_tracking_id             VARCHAR(128),
  porter_order_id                VARCHAR(128),
  porter_booking_url             TEXT,
  delivery_person_id             INT,
  eway_bill_number               VARCHAR(30),
  eway_bill_date                 DATE,
  warehouse_dispatch_esign_url   TEXT,
  warehouse_dispatch_signer_name VARCHAR(255),
  recipient_esign_url            TEXT,
  recipient_signer_name          VARCHAR(255),
  dispatched_at                  TIMESTAMPTZ,
  pdf_path                       TEXT,
  created_by                     INT REFERENCES users(user_id) ON DELETE SET NULL,
  created_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scrap_challans_status ON scrap_challans(status);

CREATE TABLE IF NOT EXISTS scrap_challan_items (
  id             SERIAL PRIMARY KEY,
  challan_number VARCHAR(64) NOT NULL REFERENCES scrap_challans(challan_number) ON DELETE CASCADE,
  instance_id    INT NOT NULL REFERENCES part_instances(instance_id) ON DELETE CASCADE,
  prt_id         VARCHAR(30),
  part_id        INT REFERENCES parts(part_id),
  part_name      VARCHAR(255),
  serial_number  VARCHAR(255),
  unit_cost      NUMERIC(12,2),
  item_remarks   TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (challan_number, instance_id)
);

CREATE INDEX IF NOT EXISTS idx_scrap_items_instance ON scrap_challan_items(instance_id);

ALTER TABLE part_instances ADD COLUMN IF NOT EXISTS scrap_challan_number VARCHAR(64);
