-- Warehouse carret slots (Carret 1–30, up to 17 laptops each) + QC2 inventory tag on production_assets.

ALTER TABLE vendor_serial_numbers
  ADD COLUMN IF NOT EXISTS warehouse_carret SMALLINT,
  ADD COLUMN IF NOT EXISTS warehouse_carret_slot SMALLINT;

ALTER TABLE production_assets
  ADD COLUMN IF NOT EXISTS inventory_tag VARCHAR(16);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vsn_warehouse_carret_slot
  ON vendor_serial_numbers (warehouse_carret, warehouse_carret_slot)
  WHERE warehouse_carret IS NOT NULL
    AND warehouse_carret_slot IS NOT NULL
    AND deleted_at IS NULL;
