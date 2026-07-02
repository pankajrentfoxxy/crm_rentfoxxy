-- Vendor repair DC: billing/shipping, per-item remarks, partial receive tracking

ALTER TABLE vendor_repair_delivery_challans
  ADD COLUMN IF NOT EXISTS billing_address TEXT,
  ADD COLUMN IF NOT EXISTS shipping_address TEXT,
  ADD COLUMN IF NOT EXISTS pdf_path TEXT,
  ADD COLUMN IF NOT EXISTS receive_pdf_path TEXT,
  ADD COLUMN IF NOT EXISTS receive_dc_number VARCHAR(64),
  ADD COLUMN IF NOT EXISTS items_dispatched_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS items_received_count INTEGER DEFAULT 0;

ALTER TABLE vendor_repair_dc_items
  ADD COLUMN IF NOT EXISTS item_remarks TEXT,
  ADD COLUMN IF NOT EXISTS item_status VARCHAR(32) DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS receive_dc_number VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_vrdc_items_status ON vendor_repair_dc_items(dc_number, item_status);
