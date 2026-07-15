-- Lock PO/GRN config at acceptance. Working edits live on production_assets only.
-- Additive / idempotent.

ALTER TABLE vendor_serial_numbers
  ADD COLUMN IF NOT EXISTS grn_received_config JSONB,
  ADD COLUMN IF NOT EXISTS config_locked_at TIMESTAMPTZ;

ALTER TABLE vendor_product_details
  ADD COLUMN IF NOT EXISTS config_locked_at TIMESTAMPTZ;

ALTER TABLE vendor_goods_received_notes
  ADD COLUMN IF NOT EXISTS config_locked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_vsn_config_locked
  ON vendor_serial_numbers (po_id)
  WHERE config_locked_at IS NOT NULL;

COMMENT ON COLUMN vendor_serial_numbers.grn_received_config IS
  'Immutable GRN-accepted hardware config snapshot. Never overwrite after lock.';
COMMENT ON COLUMN vendor_serial_numbers.config_locked_at IS
  'When set, PO/GRN config for this unit is frozen; edits go to production_assets.';
COMMENT ON COLUMN vendor_product_details.config_locked_at IS
  'When set, ordered VPD config fields must not be updated.';

-- Backfill freeze from current serial extra / PA grn_config for already-received units.
UPDATE vendor_serial_numbers vsn
   SET grn_received_config = COALESCE(
         vsn.grn_received_config,
         pa.grn_config,
         jsonb_strip_nulls(jsonb_build_object(
           'brand', NULLIF(TRIM(COALESCE(vsn.extra->>'brand', '')), ''),
           'model', NULLIF(TRIM(COALESCE(vsn.extra->>'model', '')), ''),
           'processor', NULLIF(TRIM(COALESCE(vsn.extra->>'processor', '')), ''),
           'generation', NULLIF(TRIM(COALESCE(vsn.extra->>'generation', '')), ''),
           'ram', NULLIF(TRIM(COALESCE(vsn.extra->>'ram', '')), ''),
           'storage', NULLIF(TRIM(COALESCE(vsn.extra->>'storage', vsn.extra->>'ssd', '')), ''),
           'gpu', NULLIF(TRIM(COALESCE(vsn.extra->>'gpu', '')), ''),
           'screen_size', NULLIF(TRIM(COALESCE(vsn.extra->>'screen_size', '')), ''),
           'os', NULLIF(TRIM(COALESCE(vsn.extra->>'os', '')), '')
         ))
       ),
       config_locked_at = COALESCE(vsn.config_locked_at, vsn.created_at, NOW())
  FROM production_assets pa
 WHERE pa.vendor_serial_id = vsn.serial_id
   AND vsn.deleted_at IS NULL
   AND vsn.grn_id IS NOT NULL
   AND vsn.grn_received_config IS NULL;

UPDATE vendor_serial_numbers vsn
   SET grn_received_config = COALESCE(
         vsn.grn_received_config,
         jsonb_strip_nulls(jsonb_build_object(
           'brand', NULLIF(TRIM(COALESCE(vsn.extra->>'brand', '')), ''),
           'model', NULLIF(TRIM(COALESCE(vsn.extra->>'model', '')), ''),
           'processor', NULLIF(TRIM(COALESCE(vsn.extra->>'processor', '')), ''),
           'generation', NULLIF(TRIM(COALESCE(vsn.extra->>'generation', '')), ''),
           'ram', NULLIF(TRIM(COALESCE(vsn.extra->>'ram', '')), ''),
           'storage', NULLIF(TRIM(COALESCE(vsn.extra->>'storage', vsn.extra->>'ssd', '')), ''),
           'gpu', NULLIF(TRIM(COALESCE(vsn.extra->>'gpu', '')), ''),
           'screen_size', NULLIF(TRIM(COALESCE(vsn.extra->>'screen_size', '')), ''),
           'os', NULLIF(TRIM(COALESCE(vsn.extra->>'os', '')), '')
         ))
       ),
       config_locked_at = COALESCE(vsn.config_locked_at, vsn.created_at, NOW())
 WHERE vsn.deleted_at IS NULL
   AND vsn.grn_id IS NOT NULL
   AND vsn.grn_received_config IS NULL;

-- Lock VPD rows that already have at least one received serial on the PO.
UPDATE vendor_product_details vpd
   SET config_locked_at = COALESCE(vpd.config_locked_at, NOW())
 WHERE vpd.config_locked_at IS NULL
   AND EXISTS (
     SELECT 1 FROM vendor_serial_numbers vsn
      WHERE vsn.po_id = vpd.po_id
        AND vsn.deleted_at IS NULL
        AND vsn.grn_id IS NOT NULL
   );

UPDATE vendor_goods_received_notes grn
   SET config_locked_at = COALESCE(grn.config_locked_at, grn.created_at, NOW())
 WHERE grn.deleted_at IS NULL
   AND grn.config_locked_at IS NULL
   AND EXISTS (
     SELECT 1 FROM vendor_serial_numbers vsn
      WHERE vsn.grn_id = grn.grn_id AND vsn.deleted_at IS NULL
   );
