-- 171_sale_dc_compliance.sql
-- Sale DC: vehicle at dispatch, manual e-invoice / e-way bill uploads.

ALTER TABLE delivery_challan_lines
  ADD COLUMN IF NOT EXISTS vehicle_number VARCHAR(20),
  ADD COLUMN IF NOT EXISTS einvoice_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS einvoice_pdf_path TEXT,
  ADD COLUMN IF NOT EXISTS einvoice_uploaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS einvoice_uploaded_by INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS eway_bill_pdf_path TEXT;

CREATE INDEX IF NOT EXISTS idx_dcl_einvoice_uploaded
  ON delivery_challan_lines (einvoice_uploaded_at)
  WHERE einvoice_uploaded_at IS NOT NULL;
