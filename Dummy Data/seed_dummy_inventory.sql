-- Dummy laptops for LOCAL / STAGING only. Do not run via backend/migrations.
-- Tags: is_dummy = true, machine_number prefix DUMMY-LAP-
-- Status 'In Stock' matches sales-available inventory filters (Cooling Period + In Stock).

ALTER TABLE inventory ADD COLUMN IF NOT EXISTS is_dummy BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_inventory_is_dummy ON inventory (is_dummy) WHERE is_dummy = true;

INSERT INTO inventory (
    machine_number,
    serial_number,
    device_type,
    brand,
    model,
    processor,
    generation,
    ram,
    storage,
    gpu,
    screen_size,
    stock_type,
    status,
    grade,
    is_dummy
)
SELECT
    'DUMMY-LAP-' || LPAD(g::text, 3, '0'),
    'DUMMY-SN-' || LPAD(g::text, 3, '0'),
    'Laptop',
    'Dummy Brand',
    'Dummy Model ' || g,
    'i5-8265U',
    '8th',
    '8GB',
    '256GB SSD',
    '',
    '14-inch',
    'Cooling Period',
    'In Stock',
    NULL,
    true
FROM generate_series(1, 20) AS g
WHERE NOT EXISTS (
    SELECT 1 FROM inventory i WHERE i.machine_number = 'DUMMY-LAP-' || LPAD(g::text, 3, '0')
);
