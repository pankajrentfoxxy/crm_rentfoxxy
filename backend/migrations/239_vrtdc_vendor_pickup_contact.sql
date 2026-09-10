-- Vendor Pickup collector + vehicle on Return-to-Vendor DCs (VRTDC)
ALTER TABLE vendor_return_delivery_challans
  ADD COLUMN IF NOT EXISTS vendor_pickup_person VARCHAR(255),
  ADD COLUMN IF NOT EXISTS vendor_pickup_mobile VARCHAR(20),
  ADD COLUMN IF NOT EXISTS vehicle_number VARCHAR(20);
