-- 354: asset_available — a laptop must be QC-passed to be attachable
-- (claude/carret-stock.md, ST-D3). Same view as 263 plus one clause.

CREATE OR REPLACE VIEW public.asset_available AS
SELECT
  vsn.serial_id,
  COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id') AS ttspl_id,
  vsn.serial_number,
  vsn.inventory_status,
  vsn.qc_status,
  vsn.current_entity,
  vsn.po_id,
  vsn.rent_monthly_rate,
  vsn.extra
FROM public.vendor_serial_numbers vsn
WHERE vsn.deleted_at IS NULL

  -- Canonical and on the shelf. NULL is NOT in stock (decision D1): 1,345 real
  -- laptops have never been through GRN.
  AND vsn.inventory_status = 'in_stock'

  -- 354 (claude/carret-stock.md, ST-D3): a LAPTOP is attachable only once QC
  -- has passed it. D5 left qc_status out because it was unreliable; the 27 Sep
  -- stock review found the ~286 un-passed in-stock laptops really were not QC'd
  -- (qc_pending from GRN, or on the floor), and sales could attach them.
  -- Spare-part serials (spo_id) have no QC step and are unchanged.
  AND (vsn.spo_id IS NOT NULL
       OR LOWER(COALESCE(vsn.qc_status, vsn.extra->>'status', '')) = 'passed')
  AND vsn.current_customer_id IS NULL

  AND COALESCE(vsn.extra->>'awaiting_inventory_receive', 'false') <> 'true'

  -- A live promise. ONLY 'attached' — see the note above on why 'dispatched'
  -- cannot be included without hiding 169 units that are genuinely back.
  AND NOT EXISTS (
    SELECT 1
      FROM public.sales_order_serials sos
     WHERE sos.serial_id = vsn.serial_id
       AND sos.status = 'attached'
  )

  -- On the floor.
  AND NOT EXISTS (
    SELECT 1
      FROM public.tickets t
     WHERE t.vendor_serial_id = vsn.serial_id
       AND t.status IN ('in_progress', 'on_hold', 'diagnosis_failed', 'out_for_repair')
  );

COMMENT ON VIEW public.asset_available IS
  'Part 2.5 / I10, corrected in 263, QC-passed laptops only since 354. The ONE '
  'definition of an attachable asset; do not write a second.';
