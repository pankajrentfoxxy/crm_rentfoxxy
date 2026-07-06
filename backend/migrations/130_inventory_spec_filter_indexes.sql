-- Speed up inventory spec filtering and listing across QC, repair, ready-to-rent, floor tickets

CREATE INDEX IF NOT EXISTS idx_vsn_deleted_updated
  ON vendor_serial_numbers (updated_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vsn_extra_brand
  ON vendor_serial_numbers ((LOWER(TRIM(extra->>'brand'))))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vsn_extra_model
  ON vendor_serial_numbers ((LOWER(TRIM(extra->>'model'))))
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vsn_po_id
  ON vendor_serial_numbers (po_id)
  WHERE deleted_at IS NULL AND po_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_brand_lower
  ON inventory (LOWER(TRIM(brand)));

CREATE INDEX IF NOT EXISTS idx_inventory_serial_lower
  ON inventory (LOWER(TRIM(serial_number)));

CREATE INDEX IF NOT EXISTS idx_tickets_status_created
  ON tickets (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_vendor_serial
  ON tickets (vendor_serial_id)
  WHERE vendor_serial_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_brand_lower
  ON tickets (LOWER(TRIM(brand)));

CREATE INDEX IF NOT EXISTS idx_tickets_current_stage
  ON tickets (current_stage_id, status);
