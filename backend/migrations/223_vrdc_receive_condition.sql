-- Warehouse receive power state on vendor-repair DC items.
-- on      = laptop powers on; vendor-return config script is required
-- not_on  = dead unit; warehouse types the serial and skips the capture script

ALTER TABLE vendor_repair_dc_items
  ADD COLUMN IF NOT EXISTS receive_laptop_condition VARCHAR(20);

COMMENT ON COLUMN vendor_repair_dc_items.receive_laptop_condition IS
  'on | not_on | part_missing — warehouse receive power state';
