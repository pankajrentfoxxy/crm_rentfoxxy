ALTER TABLE vendor_purchase_orders
  ADD COLUMN IF NOT EXISTS vendor_invoice_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS vendor_invoice_file TEXT,
  ADD COLUMN IF NOT EXISTS vendor_invoice_uploaded_at TIMESTAMPTZ;
