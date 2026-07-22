-- VRDC dispatch signer names + per-item receive signatures / verification

ALTER TABLE vendor_repair_delivery_challans
  ADD COLUMN IF NOT EXISTS warehouse_dispatch_signer_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS vendor_dispatch_signer_name VARCHAR(255);

ALTER TABLE vendor_repair_dc_items
  ADD COLUMN IF NOT EXISTS receive_verified_serial VARCHAR(128),
  ADD COLUMN IF NOT EXISTS receive_wh_esign_url TEXT,
  ADD COLUMN IF NOT EXISTS receive_wh_signer_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS receive_wh_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS receive_vendor_esign_url TEXT,
  ADD COLUMN IF NOT EXISTS receive_vendor_signer_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS receive_vendor_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS replacement_generation VARCHAR(64),
  ADD COLUMN IF NOT EXISTS replaced_original_ttspl_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS replaced_original_serial VARCHAR(128);
