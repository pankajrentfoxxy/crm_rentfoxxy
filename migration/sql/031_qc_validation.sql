-- 031 QC Process — validation queries (run on CRM PostgreSQL)

-- BEFORE migration: old bucket (all non-passed) — expect ~3556
SELECT COUNT(*)::int AS crm_old_non_passed_bucket
FROM vendor_serial_numbers s
INNER JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
WHERE s.deleted_at IS NULL AND s.po_id IS NOT NULL
  AND COALESCE(NULLIF(TRIM(s.qc_status), ''), NULLIF(TRIM(s.extra->>'status'), ''), 'pending') <> 'passed';

-- BEFORE/AFTER: ERP-aligned QC Process bucket (pending only)
SELECT COUNT(*)::int AS crm_qc_process_pending
FROM vendor_serial_numbers s
INNER JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
WHERE s.deleted_at IS NULL AND s.po_id IS NOT NULL
  AND COALESCE(NULLIF(TRIM(s.qc_status), ''), NULLIF(TRIM(s.extra->>'status'), ''), 'pending') = 'pending';

-- Status breakdown (diagnose inflated counts)
SELECT COALESCE(NULLIF(TRIM(s.qc_status), ''), NULLIF(TRIM(s.extra->>'status'), ''), 'pending') AS effective_status,
       COUNT(*)::int AS c
FROM vendor_serial_numbers s
INNER JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
WHERE s.deleted_at IS NULL AND s.po_id IS NOT NULL
GROUP BY 1
ORDER BY c DESC;

-- CRM rows in QC bucket without ERP mapping
SELECT COUNT(*)::int AS unmapped_in_pending_bucket
FROM vendor_serial_numbers s
INNER JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
LEFT JOIN erp_id_map m ON m.entity = 'serial_numbers' AND m.crm_id = s.serial_id
WHERE s.deleted_at IS NULL AND s.po_id IS NOT NULL
  AND COALESCE(NULLIF(TRIM(s.qc_status), ''), NULLIF(TRIM(s.extra->>'status'), ''), 'pending') = 'pending'
  AND m.erp_id IS NULL;

-- AFTER migration: backup row count
SELECT COUNT(*)::int AS backup_rows FROM vendor_serial_numbers_qc_backup_031;

-- Compare sample mismatches (ERP mapped rows where qc_status still differs from extra.status legacy)
SELECT s.serial_id, s.serial_number, s.qc_status, s.extra->>'status' AS extra_status, s.inventory_status
FROM vendor_serial_numbers s
WHERE s.deleted_at IS NULL AND s.po_id IS NOT NULL
  AND s.qc_status IS DISTINCT FROM COALESCE(s.extra->>'status', s.qc_status)
LIMIT 25;
