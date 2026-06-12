-- Vendor Management module (PostgreSQL) — aligns with Laravel sellers / PO / GRN / billing concepts
-- Safe to run multiple times for idempotent types / indexes via IF NOT EXISTS where applicable.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---- vendors (maps to Laravel sellers / Seller model) ---------------------------------
CREATE TABLE IF NOT EXISTS vendors (
    vendor_id SERIAL PRIMARY KEY,
    status VARCHAR(32) NOT NULL DEFAULT 'approved', -- pending | approved | suspended
    first_name VARCHAR(255) NOT NULL,
    last_name VARCHAR(255),
    business_name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(32) NOT NULL,
    password_hash TEXT NOT NULL,
    address TEXT NOT NULL,
    business_type VARCHAR(255) NOT NULL,
    registration_date DATE NOT NULL,
    state VARCHAR(128) NOT NULL,
    gst_number VARCHAR(64),
    brand_code VARCHAR(64),
    business_registration_number VARCHAR(128),
    tax_identification_number VARCHAR(128),
    bank_name VARCHAR(255) NOT NULL,
    account_number VARCHAR(64) NOT NULL,
    bank_ifsc_code VARCHAR(32) NOT NULL,
    account_holder_name VARCHAR(255) NOT NULL,
    image_url TEXT,
    licenses_url TEXT,
    remember_pass_plain TEXT, -- legacy parity with Laravel sellers.remember_pass (prefer not to populate in prod)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendors_email_active
    ON vendors (LOWER(email))
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vendors_status ON vendors (status);
CREATE INDEX IF NOT EXISTS idx_vendors_deleted ON vendors (deleted_at);

-- ---- vendor shops (maps to Laravel shops rows) -----------------------------------------
CREATE TABLE IF NOT EXISTS vendor_shops (
    shop_id SERIAL PRIMARY KEY,
    vendor_id INT NOT NULL REFERENCES vendors(vendor_id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    address TEXT,
    contact VARCHAR(32),
    image_url TEXT,
    banner_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_shops_one_active
    ON vendor_shops (vendor_id)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vendor_shops_vendor ON vendor_shops (vendor_id);

-- ---- vendor wallet snapshot (seller_wallets) -------------------------------------------
CREATE TABLE IF NOT EXISTS vendor_wallets (
    wallet_id SERIAL PRIMARY KEY,
    vendor_id INT NOT NULL UNIQUE REFERENCES vendors(vendor_id) ON DELETE CASCADE,
    withdrawn NUMERIC(18,2) NOT NULL DEFAULT 0,
    commission_given NUMERIC(18,2) NOT NULL DEFAULT 0,
    total_earning NUMERIC(18,2) NOT NULL DEFAULT 0,
    pending_withdraw NUMERIC(18,2) NOT NULL DEFAULT 0,
    delivery_charge_earned NUMERIC(18,2) NOT NULL DEFAULT 0,
    collected_cash NUMERIC(18,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- purchase orders ----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendor_purchase_orders (
    po_id SERIAL PRIMARY KEY,
    purchase_order_number VARCHAR(64) NOT NULL,
    purchase_order_date DATE NOT NULL,
    purchase_order_type VARCHAR(64) NOT NULL, -- rental_purchase | rent_to_own | etc.
    vendor_id INT NOT NULL REFERENCES vendors(vendor_id),
    po_state VARCHAR(128) NOT NULL, -- invoicing ship-from state / company branch
    is_same_state BOOLEAN NOT NULL DEFAULT FALSE,
    sub_total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
    total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
    line_items JSONB NOT NULL DEFAULT '[]'::jsonb, -- normalized asset rows created from assets_details
    assets_details JSONB, -- raw structure from Laravel for parity
    product_details_legacy_ids JSONB, -- Laravel product_details id array stringified
    remarks TEXT,
    public_token UUID NOT NULL DEFAULT gen_random_uuid(),
    status VARCHAR(64) NOT NULL DEFAULT 'draft',
    invoice_created BOOLEAN NOT NULL DEFAULT FALSE,
    invoice_path TEXT,
    rental_period VARCHAR(128),
    status_updated_by_admin_id INT REFERENCES users(user_id) ON DELETE SET NULL,
    status_updated_by_name VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    UNIQUE (purchase_order_number)
);

CREATE INDEX IF NOT EXISTS idx_vpo_vendor ON vendor_purchase_orders (vendor_id);
CREATE INDEX IF NOT EXISTS idx_vpo_status ON vendor_purchase_orders (status);
CREATE INDEX IF NOT EXISTS idx_vpo_dates ON vendor_purchase_orders (purchase_order_date DESC);
CREATE INDEX IF NOT EXISTS idx_vpo_deleted ON vendor_purchase_orders (deleted_at);

-- ---- spare parts purchase orders ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendor_spare_parts_purchase_orders (
    spo_id SERIAL PRIMARY KEY,
    purchase_order_number VARCHAR(64) NOT NULL,
    purchase_order_date DATE NOT NULL,
    vendor_id INT NOT NULL REFERENCES vendors(vendor_id),
    po_state VARCHAR(128) NOT NULL,
    is_same_state BOOLEAN NOT NULL DEFAULT FALSE,
    sub_total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
    total_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
    line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
    assets_details JSONB,
    remarks TEXT,
    public_token UUID NOT NULL DEFAULT gen_random_uuid(),
    status VARCHAR(64) NOT NULL DEFAULT 'draft',
    status_updated_by_admin_id INT REFERENCES users(user_id) ON DELETE SET NULL,
    status_updated_by_name VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    UNIQUE (purchase_order_number)
);

CREATE INDEX IF NOT EXISTS idx_vspo_vendor ON vendor_spare_parts_purchase_orders (vendor_id);
CREATE INDEX IF NOT EXISTS idx_vspo_status ON vendor_spare_parts_purchase_orders (status);

-- ---- goods received notes (maps goods_received_notes) -----------------------------------
CREATE TABLE IF NOT EXISTS vendor_goods_received_notes (
    grn_id SERIAL PRIMARY KEY,
    po_id INT NOT NULL REFERENCES vendor_purchase_orders(po_id) ON DELETE CASCADE,
    meta JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_vgrn_po ON vendor_goods_received_notes (po_id);

-- ---- serial numbers (maps serial_numbers) -----------------------------------------------
CREATE TABLE IF NOT EXISTS vendor_serial_numbers (
    serial_id SERIAL PRIMARY KEY,
    po_id INT NOT NULL REFERENCES vendor_purchase_orders(po_id) ON DELETE CASCADE,
    grn_id INT NOT NULL REFERENCES vendor_goods_received_notes(grn_id) ON DELETE CASCADE,
    serial_number VARCHAR(255) NOT NULL,
    extra JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vendor_serial_unique
    ON vendor_serial_numbers (LOWER(serial_number))
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vendor_serial_po_grn
    ON vendor_serial_numbers (po_id, grn_id);

-- ---- serial change audit -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendor_serial_number_audit (
    audit_id SERIAL PRIMARY KEY,
    po_id INT NOT NULL,
    grn_id INT NOT NULL,
    old_serial VARCHAR(255) NOT NULL,
    new_serial VARCHAR(255) NOT NULL,
    changed_by_user_id INT REFERENCES users(user_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- billing records (monthly flows) -----------------------------------------------------
CREATE TABLE IF NOT EXISTS vendor_billing (
    billing_id SERIAL PRIMARY KEY,
    vendor_id INT REFERENCES vendors(vendor_id) ON DELETE SET NULL,
    billing_month INT NOT NULL CHECK (billing_month BETWEEN 1 AND 12),
    billing_year INT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending', -- pending | approved | completed
    assigned_to_user_id INT REFERENCES users(user_id) ON DELETE SET NULL,
    totals JSONB DEFAULT '{}'::jsonb,
    detail JSONB DEFAULT '[]'::jsonb,
    file_path TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_vendor_billing_vendor ON vendor_billing (vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_billing_status ON vendor_billing (status);
CREATE INDEX IF NOT EXISTS idx_vendor_billing_period ON vendor_billing (billing_year, billing_month);

-- ---- replaced / return products ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendor_replaced_products (
    replaced_id SERIAL PRIMARY KEY,
    vendor_id INT REFERENCES vendors(vendor_id) ON DELETE SET NULL,
    po_id INT REFERENCES vendor_purchase_orders(po_id) ON DELETE SET NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(64) NOT NULL DEFAULT 'open',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_vendor_replaced_vendor ON vendor_replaced_products (vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_replaced_status ON vendor_replaced_products (status);

-- ---- module audit log --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendor_audit_logs (
    log_id SERIAL PRIMARY KEY,
    actor_user_id INT REFERENCES users(user_id) ON DELETE SET NULL,
    vendor_id INT REFERENCES vendors(vendor_id) ON DELETE SET NULL,
    entity_type VARCHAR(64) NOT NULL,
    entity_id VARCHAR(64),
    action VARCHAR(64) NOT NULL,
    payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_audit_entity ON vendor_audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_vendor_audit_actor ON vendor_audit_logs (actor_user_id);

-- refresh tokens (optional future use)
CREATE TABLE IF NOT EXISTS vendor_refresh_tokens (
    id SERIAL PRIMARY KEY,
    vendor_id INT NOT NULL REFERENCES vendors(vendor_id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_refresh_vendor ON vendor_refresh_tokens (vendor_id);
