-- =============================================================================
-- Phase 1: Vendor procurement & vendor portal (branch new_crm_rentfoxxy)
-- Migrations: 052_phase1_vendor_procurement, 053_vendor_billing_tables,
--               054_vendor_invoice_upload, 055_vendor_portal_sessions
-- Safe to re-run (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
-- =============================================================================

-- 052: Vendor columns, PO workflow, GRN bill-pending
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
  ADD COLUMN IF NOT EXISTS bill_status VARCHAR(20) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS bill_files JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS bill_name VARCHAR(255);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vendor_goods_received_notes_bill_status_check'
  ) THEN
    ALTER TABLE vendor_goods_received_notes
      ADD CONSTRAINT vendor_goods_received_notes_bill_status_check
      CHECK (bill_status IN ('pending', 'received'));
  END IF;
EXCEPTION WHEN others THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_vpo_status_workflow ON vendor_purchase_orders (status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vgrn_bill_status ON vendor_goods_received_notes (bill_status)
  WHERE deleted_at IS NULL;

-- 053: Billing tables
CREATE TABLE IF NOT EXISTS vendor_debit_notes (
  debit_note_id SERIAL PRIMARY KEY,
  debit_note_number VARCHAR(50) NOT NULL UNIQUE,
  vendor_id INT NOT NULL REFERENCES vendors(vendor_id),
  po_id INT REFERENCES vendor_purchase_orders(po_id),
  reason VARCHAR(255) NOT NULL,
  description TEXT,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  quantity INT DEFAULT 0,
  unit_rate NUMERIC(12,2) DEFAULT 0,
  ttspl_ids JSONB DEFAULT '[]',
  status VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending','approved','adjusted','cancelled')),
  adjusted_in_bill_id INT,
  created_by INT REFERENCES users(user_id),
  approved_by INT REFERENCES users(user_id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vendor_monthly_bills (
  bill_id SERIAL PRIMARY KEY,
  bill_number VARCHAR(50) NOT NULL UNIQUE,
  vendor_id INT NOT NULL REFERENCES vendors(vendor_id),
  bill_month INT NOT NULL,
  bill_year INT NOT NULL,
  bill_date DATE NOT NULL,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  line_items JSONB NOT NULL DEFAULT '[]',
  subtotal NUMERIC(12,2) DEFAULT 0,
  gst_amount NUMERIC(12,2) DEFAULT 0,
  debit_note_adjustment NUMERIC(12,2) DEFAULT 0,
  total_payable NUMERIC(12,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'generated'
    CHECK (status IN ('generated','approved','paid','disputed')),
  payment_date DATE,
  payment_reference VARCHAR(100),
  notes TEXT,
  generated_by INT REFERENCES users(user_id),
  approved_by INT REFERENCES users(user_id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(vendor_id, bill_month, bill_year)
);

INSERT INTO sm_document_sequences (doc_type, last_value, prefix)
VALUES ('vendor_bill', 0, 'VB-'), ('vendor_debit_note', 0, 'DN-')
ON CONFLICT (doc_type) DO NOTHING;

-- 054: Vendor invoice upload on PO
ALTER TABLE vendor_purchase_orders
  ADD COLUMN IF NOT EXISTS vendor_invoice_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS vendor_invoice_file TEXT,
  ADD COLUMN IF NOT EXISTS vendor_invoice_uploaded_at TIMESTAMPTZ;

-- 055: Vendor portal sessions
CREATE TABLE IF NOT EXISTS vendor_portal_sessions (
  session_id SERIAL PRIMARY KEY,
  vendor_id INT NOT NULL REFERENCES vendors(vendor_id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_portal_sessions_vendor ON vendor_portal_sessions (vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_portal_sessions_expires ON vendor_portal_sessions (expires_at);

INSERT INTO schema_migrations (name) VALUES
  ('052_phase1_vendor_procurement.sql'),
  ('053_vendor_billing_tables.sql'),
  ('054_vendor_invoice_upload.sql'),
  ('055_vendor_portal_sessions.sql')
ON CONFLICT (name) DO NOTHING;
