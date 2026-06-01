-- Inventory Management — Laravel table name parity (read-through views on CRM vendor_* tables).
-- ERP MySQL: serial_numbers, purchase_orders, goods_received_notes, spare_parts, serial_number_parts.

-- spare_parts (Laravel getSparePartsDetailsById)
CREATE TABLE IF NOT EXISTS spare_parts (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    status SMALLINT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO spare_parts (id, name, status, created_at, updated_at)
SELECT part_id, name, CASE WHEN active THEN 1 ELSE 0 END, created_at, updated_at
FROM vendor_spare_parts_catalog
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    updated_at = EXCLUDED.updated_at;

SELECT setval(
    pg_get_serial_sequence('spare_parts', 'id'),
    GREATEST(COALESCE((SELECT MAX(id) FROM spare_parts), 1), 1)
);

-- allocation_logs / inward_outward — stubs for serial-number-status (ERP sync later)
CREATE TABLE IF NOT EXISTS allocation_logs (
    id SERIAL PRIMARY KEY,
    vendor_id INT,
    vendor_name VARCHAR(255),
    serial_number VARCHAR(255) NOT NULL,
    unique_id VARCHAR(255),
    action_taken VARCHAR(128),
    remarks TEXT,
    qc_status VARCHAR(64),
    in_ward VARCHAR(32),
    out_ward VARCHAR(32),
    extra JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_allocation_logs_serial ON allocation_logs (serial_number);

CREATE TABLE IF NOT EXISTS inward_outward (
    id SERIAL PRIMARY KEY,
    serial_number VARCHAR(255),
    unique_number VARCHAR(255),
    product_type VARCHAR(64),
    transaction_type VARCHAR(64),
    meta JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inward_outward_serial ON inward_outward (serial_number);

-- serial_numbers view (Laravel column names → vendor_serial_numbers)
CREATE OR REPLACE VIEW serial_numbers AS
SELECT
    s.serial_id AS id,
    s.po_id,
    s.grn_id AS goods_receipts_id,
    s.serial_number,
    COALESCE(s.inventory_asset_code, s.extra->>'unique_product_serial') AS unique_product_serial,
    COALESCE(NULLIF(TRIM(s.qc_status), ''), NULLIF(TRIM(s.extra->>'status'), ''), 'pending') AS status,
    COALESCE(s.inventory_status, s.extra->>'status2') AS status2,
    s.remark,
    s.extra->>'product_id' AS product_id,
    s.extra->>'product_warranty' AS product_warranty,
    s.rental_start_date AS rental_period,
    s.extra->>'require_parts' AS require_parts,
    s.extra->>'file_path' AS file_path,
    s.extra->>'came_from' AS came_from,
    s.extra->>'action_status' AS action_status,
    s.extra->>'action_remark' AS action_remark,
    s.extra->>'vendor_name' AS vendor_name,
    s.extra AS extra_json,
    s.created_at,
    s.updated_at
FROM vendor_serial_numbers s
WHERE s.deleted_at IS NULL AND s.po_id IS NOT NULL;

-- serial_number_parts view (spare PO receive lines)
CREATE OR REPLACE VIEW serial_number_parts AS
SELECT
    s.serial_id AS id,
    s.spo_id AS po_id,
    s.grn_id AS goods_receipts_id,
    s.serial_number,
    COALESCE(s.inventory_asset_code, s.extra->>'unique_product_serial') AS unique_product_serial,
    COALESCE(NULLIF(TRIM(s.qc_status), ''), NULLIF(TRIM(s.extra->>'status'), ''), 'pending') AS status,
    s.extra->>'main_serial_number' AS main_serial_number,
    s.extra->>'main_unique_number' AS main_unique_number,
    s.remark,
    s.extra,
    s.created_at,
    s.updated_at
FROM vendor_serial_numbers s
WHERE s.deleted_at IS NULL AND s.spo_id IS NOT NULL;

COMMENT ON VIEW serial_numbers IS 'Laravel serial_numbers parity — backed by vendor_serial_numbers';
COMMENT ON VIEW serial_number_parts IS 'Laravel serial_number_parts parity — vendor_serial_numbers with spo_id';
