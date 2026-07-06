-- Trigram indexes for inventory list search (serial, asset code)

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_vsn_serial_number_trgm
  ON vendor_serial_numbers
  USING gin (LOWER(TRIM(serial_number)) gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vsn_inventory_asset_code_trgm
  ON vendor_serial_numbers
  USING gin (LOWER(TRIM(COALESCE(inventory_asset_code, ''))) gin_trgm_ops)
  WHERE deleted_at IS NULL AND inventory_asset_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vpo_po_number_trgm
  ON vendor_purchase_orders
  USING gin (LOWER(TRIM(purchase_order_number)) gin_trgm_ops)
  WHERE deleted_at IS NULL;
