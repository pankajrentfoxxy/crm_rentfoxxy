-- Normalize ERP legacy out_stock → rented for units still linked to a customer.
-- Safe to re-run; only touches rows that still have the legacy status.
UPDATE vendor_serial_numbers
SET inventory_status = 'rented',
    status_changed_at = COALESCE(status_changed_at, NOW()),
    updated_at = NOW()
WHERE deleted_at IS NULL
  AND current_customer_id IS NOT NULL
  AND inventory_status = 'out_stock';

SELECT inventory_status, COUNT(*)::int AS c
FROM vendor_serial_numbers
WHERE deleted_at IS NULL AND current_customer_id IS NOT NULL
GROUP BY inventory_status
ORDER BY c DESC;
