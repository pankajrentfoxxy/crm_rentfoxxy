-- Phase 1: Vendor schema enhancements, PO manager approval workflow, GRN bill-pending

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS vendor_portal_password_hash TEXT,
  ADD COLUMN IF NOT EXISTS vendor_portal_last_login TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vendor_portal_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS po_payment_terms VARCHAR(50) DEFAULT 'postpaid_monthly',
  ADD COLUMN IF NOT EXISTS credit_days INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pan_number VARCHAR(20),
  ADD COLUMN IF NOT EXISTS msme_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS contact_person_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS contact_person_phone VARCHAR(32),
  ADD COLUMN IF NOT EXISTS alternate_phone VARCHAR(32),
  ADD COLUMN IF NOT EXISTS city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS pincode VARCHAR(10),
  ADD COLUMN IF NOT EXISTS logo_url TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Sync portal password from existing vendor password where missing
UPDATE vendors
SET vendor_portal_password_hash = password_hash
WHERE vendor_portal_password_hash IS NULL AND password_hash IS NOT NULL;

ALTER TABLE vendor_purchase_orders
  ADD COLUMN IF NOT EXISTS expected_delivery_date DATE,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_to_vendor_at TIMESTAMPTZ;

ALTER TABLE vendor_goods_received_notes
  ADD COLUMN IF NOT EXISTS bill_status VARCHAR(20) DEFAULT 'pending'
    CHECK (bill_status IN ('pending', 'received')),
  ADD COLUMN IF NOT EXISTS bill_files JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS bill_name VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_vpo_status_workflow ON vendor_purchase_orders (status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vgrn_bill_status ON vendor_goods_received_notes (bill_status)
  WHERE deleted_at IS NULL;
