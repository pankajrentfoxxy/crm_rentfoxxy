-- ERP inward_outward parity for migrated laptop history (Serial Number Status page).
ALTER TABLE inward_outward ADD COLUMN IF NOT EXISTS erp_id BIGINT;
ALTER TABLE inward_outward ADD COLUMN IF NOT EXISTS vendor_serial_id INT;
ALTER TABLE inward_outward ADD COLUMN IF NOT EXISTS customer_id INT;
ALTER TABLE inward_outward ADD COLUMN IF NOT EXISTS vendor_id INT;
ALTER TABLE inward_outward ADD COLUMN IF NOT EXISTS io_type VARCHAR(64);
ALTER TABLE inward_outward ADD COLUMN IF NOT EXISTS found_in VARCHAR(128);
ALTER TABLE inward_outward ADD COLUMN IF NOT EXISTS purpose VARCHAR(255);
ALTER TABLE inward_outward ADD COLUMN IF NOT EXISTS remarks VARCHAR(500);
ALTER TABLE inward_outward ADD COLUMN IF NOT EXISTS ticket_number VARCHAR(255);
ALTER TABLE inward_outward ADD COLUMN IF NOT EXISTS ticket_sla_time VARCHAR(64);
ALTER TABLE inward_outward ADD COLUMN IF NOT EXISTS technician_id INT;
ALTER TABLE inward_outward ADD COLUMN IF NOT EXISTS courier_name VARCHAR(255);
ALTER TABLE inward_outward ADD COLUMN IF NOT EXISTS awb_number VARCHAR(255);
ALTER TABLE inward_outward ADD COLUMN IF NOT EXISTS spare_parts_serial_number TEXT;
ALTER TABLE inward_outward ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'erp';
ALTER TABLE inward_outward ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Backfill io_type from legacy transaction_type / meta.type
UPDATE inward_outward
   SET io_type = COALESCE(
     NULLIF(TRIM(io_type), ''),
     NULLIF(TRIM(transaction_type), ''),
     NULLIF(TRIM(meta->>'type'), '')
   )
 WHERE io_type IS NULL OR TRIM(io_type) = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_inward_outward_erp_id
  ON inward_outward (erp_id) WHERE erp_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inward_outward_unique_number
  ON inward_outward (unique_number);

CREATE INDEX IF NOT EXISTS idx_inward_outward_source
  ON inward_outward (source);

COMMENT ON COLUMN inward_outward.source IS 'erp = migrated ERP history; crm = CRM-native (not shown as ERP history)';
