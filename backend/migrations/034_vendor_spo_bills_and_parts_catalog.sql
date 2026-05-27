-- Spare parts PO bills (Laravel spare PO list: bill_name, bill_files)
ALTER TABLE vendor_spare_parts_purchase_orders ADD COLUMN IF NOT EXISTS bill_name VARCHAR(255);
ALTER TABLE vendor_spare_parts_purchase_orders ADD COLUMN IF NOT EXISTS bill_files JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Optional catalog for “Parts” dropdown (Laravel SpareParts); seed via SQL as needed
CREATE TABLE IF NOT EXISTS vendor_spare_parts_catalog (
    part_id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vspc_active_name ON vendor_spare_parts_catalog (active, name);
