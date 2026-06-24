-- 032 Spare Parts — validation queries (run on CRM PostgreSQL)

-- Spare PO count (target: match ERP spare_parts_po)
SELECT COUNT(*)::int AS crm_spo_count
FROM vendor_spare_parts_purchase_orders
WHERE deleted_at IS NULL;

-- Catalog count
SELECT COUNT(*)::int AS crm_spare_catalog
FROM vendor_spare_parts_catalog;

-- Floor parts catalog (/inventory-management/parts)
SELECT COUNT(*)::int AS crm_floor_parts,
       COUNT(*) FILTER (WHERE archived IS NOT TRUE)::int AS active_floor_parts
FROM parts;

-- Spare part serials (received units)
SELECT COUNT(*)::int AS crm_spare_serials
FROM vendor_serial_numbers
WHERE spo_id IS NOT NULL AND deleted_at IS NULL;

-- SPO by status
SELECT status, COUNT(*)::int AS c
FROM vendor_spare_parts_purchase_orders
WHERE deleted_at IS NULL
GROUP BY status ORDER BY c DESC;

-- ERP-mapped SPO coverage
SELECT COUNT(*)::int AS mapped_spos
FROM erp_id_map
WHERE entity = 'spare_parts_po';

-- SPO without vendor (should be 0)
SELECT spo_id, purchase_order_number, vendor_id
FROM vendor_spare_parts_purchase_orders
WHERE deleted_at IS NULL
  AND vendor_id IS NULL
LIMIT 10;

-- Backup table after migration
SELECT COUNT(*)::int AS backup_spo_rows FROM vendor_spare_parts_po_backup_032;

-- Floor catalog linked to vendor spare catalog
SELECT COUNT(*)::int AS linked_floor_parts
FROM vendor_spare_parts_catalog
WHERE floor_part_id IS NOT NULL;
