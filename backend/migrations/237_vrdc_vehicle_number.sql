-- Inhouse / delivery-boy vehicle number on Vendor Repair DC (laptop + part).
ALTER TABLE vendor_repair_delivery_challans
  ADD COLUMN IF NOT EXISTS vehicle_number VARCHAR(20);
