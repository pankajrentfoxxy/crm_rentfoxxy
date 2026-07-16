-- 148: VRDC Price / HSN (per item) + E-way Bill (DC head)
ALTER TABLE vendor_repair_dc_items
  ADD COLUMN IF NOT EXISTS price NUMERIC(12, 2),
  ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(12);

ALTER TABLE vendor_repair_delivery_challans
  ADD COLUMN IF NOT EXISTS eway_bill_number VARCHAR(30),
  ADD COLUMN IF NOT EXISTS eway_bill_date DATE;
