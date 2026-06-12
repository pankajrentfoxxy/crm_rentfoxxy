-- QC / lifecycle parity with Laravel serial_numbers.status + status2 + remarks.

ALTER TABLE vendor_serial_numbers ADD COLUMN IF NOT EXISTS qc_status VARCHAR(64);
ALTER TABLE vendor_serial_numbers ADD COLUMN IF NOT EXISTS inventory_status VARCHAR(64);
ALTER TABLE vendor_serial_numbers ADD COLUMN IF NOT EXISTS remark TEXT;

CREATE INDEX IF NOT EXISTS idx_vendor_serial_inventory_status_po
    ON vendor_serial_numbers (inventory_status, po_id)
    WHERE deleted_at IS NULL AND po_id IS NOT NULL;
