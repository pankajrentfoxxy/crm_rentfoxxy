-- 208: dispatch_ready — DC created, waiting at warehouse gate.
-- in_transit + dispatched_at are set when Guard submits outward.
-- Status check on delivery_challan_lines is updated in 209.

COMMENT ON COLUMN vendor_serial_numbers.inventory_status IS
  'Canonical: in_stock, reserved, dispatch_ready, in_transit, rented, on_demo, sold, returned, in_repair, qc_failed, scrapped';
