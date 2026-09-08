-- Accounts Team proof document for VRDC E-Way Bill (image or PDF).
ALTER TABLE vendor_repair_delivery_challans
  ADD COLUMN IF NOT EXISTS eway_bill_pdf_path TEXT;
