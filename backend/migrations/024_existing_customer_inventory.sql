-- ERP-backed customer directory + per-customer asset lines (rental / sale / demo)

BEGIN;

CREATE TABLE IF NOT EXISTS existing_customer (
    customer_id INTEGER PRIMARY KEY,
    customer_name VARCHAR(500),
    contact_person_name VARCHAR(300),
    contact_person_number VARCHAR(80),
    customer_number VARCHAR(80),
    email VARCHAR(320),
    billing_address JSONB,
    shipping_address JSONB,
    erp_raw JSONB,
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_existing_customer_name ON existing_customer (LOWER(customer_name));
CREATE INDEX IF NOT EXISTS idx_existing_customer_email ON existing_customer (LOWER(email));

CREATE TABLE IF NOT EXISTS customer_inventory (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES existing_customer (customer_id) ON DELETE CASCADE,
    asset_kind VARCHAR(20) NOT NULL,
    asset_bucket VARCHAR(20) NOT NULL DEFAULT 'live',
    delivery_challan_id BIGINT,
    dc_number VARCHAR(80),
    delivery_date TIMESTAMP WITH TIME ZONE,
    erp_serial_id VARCHAR(80),
    serial_number VARCHAR(120),
    unique_serial_number VARCHAR(120),
    model_name VARCHAR(300),
    generation VARCHAR(80),
    screen_size VARCHAR(80),
    ram VARCHAR(120),
    storage VARCHAR(200),
    gpu VARCHAR(200),
    processor VARCHAR(120),
    quotation_type VARCHAR(40),
    rate VARCHAR(80),
    locking_period INTEGER,
    delivery_status VARCHAR(80),
    delivery_type VARCHAR(120),
    courier_name VARCHAR(120),
    awb_number VARCHAR(120),
    sales_status VARCHAR(80),
    documents JSONB,
    erp_raw JSONB,
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_inventory_line ON customer_inventory (
    customer_id,
    asset_kind,
    asset_bucket,
    COALESCE(delivery_challan_id::text, ''),
    COALESCE(erp_serial_id, ''),
    COALESCE(unique_serial_number, ''),
    COALESCE(serial_number, '')
);

CREATE INDEX IF NOT EXISTS idx_customer_inventory_customer ON customer_inventory (customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_inventory_unique_serial ON customer_inventory (unique_serial_number);
CREATE INDEX IF NOT EXISTS idx_customer_inventory_serial ON customer_inventory (serial_number);

COMMIT;
