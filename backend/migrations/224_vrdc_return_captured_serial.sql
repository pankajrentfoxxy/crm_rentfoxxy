-- BIOS serial fetched by the vendor-return capture script (ON receive).

ALTER TABLE vendor_repair_dc_items
  ADD COLUMN IF NOT EXISTS return_captured_serial VARCHAR(120);

COMMENT ON COLUMN vendor_repair_dc_items.return_captured_serial IS
  'Serial read by the vendor-return hardware script; required for ON receive';
