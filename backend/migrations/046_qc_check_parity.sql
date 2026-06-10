-- QC check parity — repair_logs, rent_devices, allocation_logs columns, vendor_product_inventory (Laravel inventory).

-- repair_logs (Laravel RepairLog)
CREATE TABLE IF NOT EXISTS repair_logs (
    id SERIAL PRIMARY KEY,
    serial_number_id INT NOT NULL,
    serial_number VARCHAR(255),
    unique_number VARCHAR(255),
    new_serial_number VARCHAR(255),
    new_unique_number VARCHAR(255),
    repair_start_date DATE,
    repair_end_date DATE,
    type VARCHAR(64),
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_repair_logs_serial_id ON repair_logs (serial_number_id);

-- rent_devices (Laravel RentDevice — vendor rental tracking on PO receive)
CREATE TABLE IF NOT EXISTS rent_devices (
    id SERIAL PRIMARY KEY,
    serial_id INT NOT NULL,
    po_id INT,
    dc_number VARCHAR(64),
    serial_number VARCHAR(255),
    unique_number VARCHAR(255),
    product_id INT,
    rent_start_date DATE,
    rent_end_date DATE,
    rent_amount DECIMAL(12, 2),
    month_rent DECIMAL(12, 2),
    rent_with_gst DECIMAL(12, 2),
    total_amount DECIMAL(12, 2),
    vendor_id INT,
    type VARCHAR(64),
    status VARCHAR(64),
    customer_id INT,
    rent_stop_date DATE,
    rent_start_date_again DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rent_devices_serial_id ON rent_devices (serial_id);

-- vendor_product_inventory (Laravel inventory table — QC passed → in_stock)
CREATE TABLE IF NOT EXISTS vendor_product_inventory (
    id SERIAL PRIMARY KEY,
    product_id INT,
    serial_id INT NOT NULL REFERENCES vendor_serial_numbers (serial_id) ON DELETE CASCADE,
    serial_number VARCHAR(255) NOT NULL,
    unique_product_serial VARCHAR(255),
    product_model_name VARCHAR(255),
    status VARCHAR(64) NOT NULL DEFAULT 'in_stock',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_product_inventory_serial_id
    ON vendor_product_inventory (serial_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_product_inventory_serial_number
    ON vendor_product_inventory (LOWER(serial_number));

-- allocation_logs — extend stub to Laravel AllocationLog columns
ALTER TABLE allocation_logs ADD COLUMN IF NOT EXISTS user_id INT;
ALTER TABLE allocation_logs ADD COLUMN IF NOT EXISTS customer_id INT;
ALTER TABLE allocation_logs ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255);
ALTER TABLE allocation_logs ADD COLUMN IF NOT EXISTS challan_id INT;
ALTER TABLE allocation_logs ADD COLUMN IF NOT EXISTS product_id INT;
ALTER TABLE allocation_logs ADD COLUMN IF NOT EXISTS model_name VARCHAR(255);
ALTER TABLE allocation_logs ADD COLUMN IF NOT EXISTS old_serial_number VARCHAR(255);
ALTER TABLE allocation_logs ADD COLUMN IF NOT EXISTS po_type VARCHAR(64);
ALTER TABLE allocation_logs ADD COLUMN IF NOT EXISTS purchase_type VARCHAR(64);
ALTER TABLE allocation_logs ADD COLUMN IF NOT EXISTS locking_period INT;
ALTER TABLE allocation_logs ADD COLUMN IF NOT EXISTS added_date TIMESTAMPTZ;
ALTER TABLE allocation_logs ADD COLUMN IF NOT EXISTS failure_reason TEXT;
ALTER TABLE allocation_logs ADD COLUMN IF NOT EXISTS checked_by INT;
ALTER TABLE allocation_logs ADD COLUMN IF NOT EXISTS assigned_to INT;
ALTER TABLE allocation_logs ADD COLUMN IF NOT EXISTS warranty_status VARCHAR(128);
ALTER TABLE allocation_logs ADD COLUMN IF NOT EXISTS rental_status VARCHAR(128);
ALTER TABLE allocation_logs ADD COLUMN IF NOT EXISTS extra_details JSONB DEFAULT '{}'::jsonb;
ALTER TABLE allocation_logs ADD COLUMN IF NOT EXISTS require_parts TEXT;
ALTER TABLE allocation_logs ADD COLUMN IF NOT EXISTS file_path TEXT;
ALTER TABLE allocation_logs ADD COLUMN IF NOT EXISTS log_type VARCHAR(64);
ALTER TABLE allocation_logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_allocation_logs_vendor ON allocation_logs (vendor_id);
CREATE INDEX IF NOT EXISTS idx_allocation_logs_product ON allocation_logs (product_id);
