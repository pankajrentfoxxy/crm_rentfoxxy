-- 122 — Unify Out For Repare visibility: sync qc_status / inventory_status / extra
-- for migrated ERP laptops so they appear on Inventory → Out for Repair.

UPDATE vendor_serial_numbers vsn
   SET qc_status = 'out_for_repare',
       inventory_status = CASE
         WHEN vsn.inventory_status IN ('rented', 'sold', 'in_transit', 'reserved', 'on_demo') THEN vsn.inventory_status
         ELSE 'out_for_repare'
       END,
       extra = COALESCE(vsn.extra, '{}'::jsonb) || jsonb_build_object(
         'status', 'out_for_repare',
         'action_status', COALESCE(NULLIF(TRIM(vsn.extra->>'action_status'), ''), 'out_for_repare'),
         'repair_type', COALESCE(NULLIF(TRIM(vsn.extra->>'repair_type'), ''), 'out_for_repare')
       ),
       updated_at = NOW()
 WHERE vsn.deleted_at IS NULL
   AND vsn.po_id IS NOT NULL
   AND vsn.inventory_status NOT IN ('rented', 'sold', 'in_transit', 'reserved', 'on_demo')
   AND (
     LOWER(COALESCE(NULLIF(TRIM(vsn.qc_status), ''), '')) = 'out_for_repare'
     OR LOWER(COALESCE(NULLIF(TRIM(vsn.extra->>'status'), ''), '')) = 'out_for_repare'
     OR LOWER(COALESCE(NULLIF(TRIM(vsn.extra->>'action_status'), ''), '')) = 'out_for_repare'
     OR vsn.inventory_status IN ('in_repair', 'out_for_repare')
   )
   AND NOT EXISTS (
     SELECT 1
       FROM vendor_repair_dc_items vri
       JOIN vendor_repair_delivery_challans vrd ON vrd.dc_number = vri.dc_number
       JOIN tickets vt ON vt.ticket_id = vri.ticket_id
      WHERE vrd.status = 'dispatched'
        AND vt.status = 'out_for_repair'
        AND (vri.serial_id = vsn.serial_id OR vri.serial_number = vsn.serial_number)
   );
