-- Rollback 032 spare parts resync (SPO rows only)
-- Restores vendor_spare_parts_purchase_orders from JSON snapshot backup.

BEGIN;

UPDATE vendor_spare_parts_purchase_orders t
   SET purchase_order_number = (b.row_snapshot->>'purchase_order_number'),
       purchase_order_date = (b.row_snapshot->>'purchase_order_date')::date,
       vendor_id = (b.row_snapshot->>'vendor_id')::int,
       po_state = b.row_snapshot->>'po_state',
       is_same_state = (b.row_snapshot->>'is_same_state')::boolean,
       sub_total_amount = (b.row_snapshot->>'sub_total_amount')::numeric,
       total_amount = (b.row_snapshot->>'total_amount')::numeric,
       line_items = (b.row_snapshot->>'line_items')::jsonb,
       assets_details = (b.row_snapshot->'assets_details'),
       remarks = b.row_snapshot->>'remarks',
       status = b.row_snapshot->>'status',
       bill_name = b.row_snapshot->>'bill_name',
       bill_files = COALESCE(b.row_snapshot->'bill_files', '[]'::jsonb),
       updated_at = NOW()
  FROM vendor_spare_parts_po_backup_032 b
 WHERE t.spo_id = b.spo_id;

-- Note: newly inserted SPOs / serials / GRNs from 032 are NOT auto-deleted.
-- To remove inserts, delete by erp_id_map entries created after migration timestamp.

-- COMMIT;
-- ROLLBACK;
