-- Laravel product_details parity — one row per PO asset line.

CREATE TABLE IF NOT EXISTS vendor_product_details (
    product_detail_id SERIAL PRIMARY KEY,
    po_id INT REFERENCES vendor_purchase_orders (po_id) ON DELETE CASCADE,
    category VARCHAR(128),
    brand VARCHAR(255),
    model VARCHAR(255),
    processor VARCHAR(255),
    generation VARCHAR(128),
    ram VARCHAR(64),
    storage VARCHAR(128),
    gpu VARCHAR(128),
    screen_size VARCHAR(64),
    quantity INT NOT NULL DEFAULT 1,
    rate NUMERIC(18, 2) NOT NULL DEFAULT 0,
    remarks TEXT,
    total_amount NUMERIC(18, 2),
    vendor_locking_period INT,
    warranty INT,
    parts INT,
    status VARCHAR(64),
    random_id VARCHAR(64),
    old_product_id INT,
    old_product_details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_product_details_po ON vendor_product_details (po_id);

-- Laravel read-through view (optional ERP parity)
CREATE OR REPLACE VIEW product_details AS
SELECT
    product_detail_id AS id,
    po_id,
    category,
    brand,
    model,
    processor,
    generation,
    ram,
    storage,
    gpu,
    screen_size,
    quantity,
    rate,
    remarks,
    total_amount,
    vendor_locking_period,
    warranty,
    parts,
    status,
    random_id,
    old_product_id,
    old_product_details,
    created_at,
    updated_at
FROM vendor_product_details;

COMMENT ON VIEW product_details IS 'Laravel product_details parity — backed by vendor_product_details';
