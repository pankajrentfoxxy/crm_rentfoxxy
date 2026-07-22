-- 151: allow 'customer_asset_edit' in ttspl_config_history.change_type
-- Customer asset edits (customerAssetActivityService.logCustomerAssetEdit) log
-- config changes with change_type='customer_asset_edit', which the original
-- CHECK from migration 056 rejects — the asset update commits but the API
-- returns a 500 constraint error.

ALTER TABLE ttspl_config_history
  DROP CONSTRAINT IF EXISTS ttspl_config_history_change_type_check;

ALTER TABLE ttspl_config_history
  ADD CONSTRAINT ttspl_config_history_change_type_check
  CHECK (change_type IN ('upgrade', 'replacement', 'correction', 'initial', 'customer_asset_edit'));
