-- Vendor Pickup dispatch: collector name + mobile on VRDC and scrap challans
BEGIN;

ALTER TABLE vendor_repair_delivery_challans
  ADD COLUMN IF NOT EXISTS vendor_pickup_person VARCHAR(255),
  ADD COLUMN IF NOT EXISTS vendor_pickup_mobile VARCHAR(20);

ALTER TABLE scrap_challans
  ADD COLUMN IF NOT EXISTS vendor_pickup_person VARCHAR(255),
  ADD COLUMN IF NOT EXISTS vendor_pickup_mobile VARCHAR(20);

COMMIT;
