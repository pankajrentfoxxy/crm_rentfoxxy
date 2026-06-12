-- Receiving laptops: immutable asset code + rental start date on each serial row.
-- Bulk receive allocates sequential TTSPL0001-style codes via vendor_inventory_asset_sequence.

CREATE TABLE IF NOT EXISTS vendor_inventory_asset_sequence (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    next_num INT NOT NULL DEFAULT 1
);

INSERT INTO vendor_inventory_asset_sequence (id, next_num) VALUES (1, 1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE vendor_serial_numbers ADD COLUMN IF NOT EXISTS inventory_asset_code VARCHAR(32);
ALTER TABLE vendor_serial_numbers ADD COLUMN IF NOT EXISTS rental_start_date DATE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_serial_inventory_asset_code_unique
    ON vendor_serial_numbers (inventory_asset_code)
    WHERE inventory_asset_code IS NOT NULL AND deleted_at IS NULL;
