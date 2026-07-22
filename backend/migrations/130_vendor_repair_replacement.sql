-- Vendor repair: per-item receive mode (repaired return vs vendor replacement)

ALTER TABLE vendor_repair_dc_items
  ADD COLUMN IF NOT EXISTS receive_mode VARCHAR(32),
  ADD COLUMN IF NOT EXISTS replacement_serial_number VARCHAR(128),
  ADD COLUMN IF NOT EXISTS replacement_ttspl_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS replacement_brand VARCHAR(128),
  ADD COLUMN IF NOT EXISTS replacement_model VARCHAR(255),
  ADD COLUMN IF NOT EXISTS replacement_configuration TEXT,
  ADD COLUMN IF NOT EXISTS replacement_dc_number VARCHAR(64),
  ADD COLUMN IF NOT EXISTS replacement_serial_id INTEGER REFERENCES vendor_serial_numbers(serial_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vrdc_items_replacement_dc ON vendor_repair_dc_items(replacement_dc_number);
