-- Trigram indexes for fast ILIKE/LIKE spec filters on inventory lists

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_vsn_extra_model_trgm
  ON vendor_serial_numbers
  USING gin (LOWER(COALESCE(NULLIF(TRIM(extra->>'model'), ''), NULLIF(TRIM(extra->>'model_name'), ''))) gin_trgm_ops)
  WHERE deleted_at IS NULL AND po_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_model_trgm
  ON inventory
  USING gin (LOWER(TRIM(model)) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_vpd_model_trgm
  ON vendor_product_details
  USING gin (LOWER(TRIM(model)) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_vsn_passed_qc_updated
  ON vendor_serial_numbers (updated_at DESC)
  WHERE deleted_at IS NULL
    AND po_id IS NOT NULL
    AND COALESCE(NULLIF(TRIM(qc_status), ''), 'passed') = 'passed';
