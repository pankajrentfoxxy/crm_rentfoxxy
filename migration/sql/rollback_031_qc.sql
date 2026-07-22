-- Rollback 031 QC status resync
-- Restores qc_status / inventory_status / extra from vendor_serial_numbers_qc_backup_031

BEGIN;

UPDATE vendor_serial_numbers s
   SET qc_status = b.qc_status,
       inventory_status = b.inventory_status,
       extra = b.extra,
       updated_at = NOW()
  FROM vendor_serial_numbers_qc_backup_031 b
 WHERE s.serial_id = b.serial_id;

-- Verify restore
SELECT COUNT(*)::int AS restored FROM vendor_serial_numbers_qc_backup_031 b
 JOIN vendor_serial_numbers s ON s.serial_id = b.serial_id;

-- COMMIT;  -- uncomment after verifying restored count
-- ROLLBACK;
