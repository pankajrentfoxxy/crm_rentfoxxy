-- Per-laptop courier / AWB mapping on a Delivery Challan
CREATE TABLE IF NOT EXISTS dc_shipment_units (
  id                    SERIAL PRIMARY KEY,
  dc_number             TEXT NOT NULL,
  allocation_id         INTEGER,
  serial_id             INTEGER,
  serial_number         TEXT,
  ttspl_id               TEXT,
  courier_name          TEXT DEFAULT 'BlueDart',
  awb_number            TEXT,
  weight                NUMERIC(10, 2),
  remarks               TEXT,
  tracking_status       TEXT,
  tracking_status_type  TEXT,
  tracking_synced_at    TIMESTAMPTZ,
  received_by           TEXT,
  delivered_at          TIMESTAMPTZ,
  status                TEXT NOT NULL DEFAULT 'in_transit',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dc_shipment_units_dc
  ON dc_shipment_units (dc_number);

CREATE INDEX IF NOT EXISTS idx_dc_shipment_units_awb
  ON dc_shipment_units (awb_number)
  WHERE awb_number IS NOT NULL AND TRIM(awb_number) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_dc_shipment_units_dc_awb
  ON dc_shipment_units (dc_number, awb_number)
  WHERE awb_number IS NOT NULL AND TRIM(awb_number) <> '';

COMMENT ON TABLE dc_shipment_units IS
  'One row per laptop shipment on a DC — BlueDart AWB mapping for multi-AWB DCs';
