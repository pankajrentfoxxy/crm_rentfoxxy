-- Persist processor+generation asset value used for e-way lock / accounts mail.

ALTER TABLE delivery_challan_lines
  ADD COLUMN IF NOT EXISTS eway_asset_value NUMERIC(12, 2);
