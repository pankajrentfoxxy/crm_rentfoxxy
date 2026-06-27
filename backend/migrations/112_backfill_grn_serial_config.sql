-- ============================================================
-- Migration 112: Backfill serial + ticket config from GRN sources
-- (inventory / vendor_product_details), not wrong PO line_items.
-- Idempotent: safe to re-run.
-- ============================================================

BEGIN;

-- 1) Persist GRN config on each received serial (from inventory row).
UPDATE vendor_serial_numbers s
   SET extra = COALESCE(s.extra, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
         'brand', NULLIF(TRIM(i.brand), ''),
         'model', NULLIF(TRIM(i.model), ''),
         'processor', NULLIF(TRIM(i.processor), ''),
         'generation', NULLIF(TRIM(i.generation), ''),
         'ram', NULLIF(TRIM(i.ram), ''),
         'storage', NULLIF(TRIM(i.storage), ''),
         'gpu', NULLIF(TRIM(i.gpu), ''),
         'screen_size', NULLIF(TRIM(i.screen_size), '')
       )),
       updated_at = NOW()
  FROM inventory i
 WHERE s.deleted_at IS NULL
   AND s.po_id IS NOT NULL
   AND (
     (NULLIF(s.extra->>'inventory_id', '') IS NOT NULL AND i.inventory_id = (s.extra->>'inventory_id')::int)
     OR (COALESCE(s.inventory_asset_code, '') <> '' AND i.machine_number = s.inventory_asset_code)
     OR (COALESCE(s.serial_number, '') <> '' AND LOWER(i.serial_number) = LOWER(s.serial_number))
   );

-- 2) Ensure vendor_product_details exists for legacy ERP product_id (GRN truth from inventory).
INSERT INTO vendor_product_details (
  po_id, category, brand, model, processor, generation, ram, storage, gpu, screen_size,
  quantity, rate, old_product_id
)
SELECT DISTINCT ON (s.po_id, (s.extra->>'product_id')::int)
       s.po_id,
       'Laptop',
       NULLIF(TRIM(i.brand), ''),
       NULLIF(TRIM(i.model), ''),
       NULLIF(TRIM(i.processor), ''),
       NULLIF(TRIM(i.generation), ''),
       NULLIF(TRIM(i.ram), ''),
       NULLIF(TRIM(i.storage), ''),
       NULLIF(TRIM(i.gpu), ''),
       NULLIF(TRIM(i.screen_size), ''),
       1,
       0,
       (s.extra->>'product_id')::int
  FROM vendor_serial_numbers s
  JOIN inventory i ON (
         (NULLIF(s.extra->>'inventory_id', '') IS NOT NULL AND i.inventory_id = (s.extra->>'inventory_id')::int)
      OR (COALESCE(s.inventory_asset_code, '') <> '' AND i.machine_number = s.inventory_asset_code)
      OR (COALESCE(s.serial_number, '') <> '' AND LOWER(i.serial_number) = LOWER(s.serial_number))
       )
 WHERE s.deleted_at IS NULL
   AND s.po_id IS NOT NULL
   AND NULLIF(s.extra->>'product_id', '') IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM vendor_product_details vpd
      WHERE vpd.old_product_id = (s.extra->>'product_id')::int
   )
 ORDER BY s.po_id, (s.extra->>'product_id')::int, s.serial_id DESC;

-- 3) Align floor tickets with GRN config on linked serials.
UPDATE tickets t
   SET brand = COALESCE(NULLIF(TRIM(i.brand), ''), t.brand),
       model = COALESCE(NULLIF(TRIM(i.model), ''), t.model),
       processor = COALESCE(NULLIF(TRIM(i.processor), ''), t.processor),
       ram = COALESCE(NULLIF(TRIM(i.ram), ''), t.ram),
       storage = COALESCE(NULLIF(TRIM(i.storage), ''), t.storage),
       updated_at = NOW()
  FROM vendor_serial_numbers s
  JOIN inventory i ON (
         (NULLIF(s.extra->>'inventory_id', '') IS NOT NULL AND i.inventory_id = (s.extra->>'inventory_id')::int)
      OR (COALESCE(s.inventory_asset_code, '') <> '' AND i.machine_number = s.inventory_asset_code)
      OR (COALESCE(s.serial_number, '') <> '' AND LOWER(i.serial_number) = LOWER(s.serial_number))
       )
 WHERE t.vendor_serial_id = s.serial_id
   AND s.deleted_at IS NULL;

DO $$
DECLARE
  n_serial INT;
  n_vpd INT;
  n_ticket INT;
BEGIN
  SELECT COUNT(*) INTO n_serial
    FROM vendor_serial_numbers s
   WHERE s.deleted_at IS NULL
     AND s.po_id IS NOT NULL
     AND NULLIF(s.extra->>'model', '') IS NOT NULL;

  SELECT COUNT(*) INTO n_vpd FROM vendor_product_details WHERE old_product_id IS NOT NULL;
  SELECT COUNT(*) INTO n_ticket
    FROM tickets t
    JOIN vendor_serial_numbers s ON s.serial_id = t.vendor_serial_id AND s.deleted_at IS NULL
   WHERE NULLIF(TRIM(t.model), '') IS NOT NULL;

  RAISE NOTICE '112_backfill_grn_serial_config: serials_with_model=%, vpd_with_old_product_id=%, linked_tickets=%',
    n_serial, n_vpd, n_ticket;
END $$;

INSERT INTO schema_migrations (name)
VALUES ('112_backfill_grn_serial_config.sql')
ON CONFLICT (name) DO NOTHING;

COMMIT;
