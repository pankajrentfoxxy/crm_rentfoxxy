-- Phase 5: Customer billing engine, e-invoice tracking,
-- credit/debit notes, security deposits

CREATE TABLE IF NOT EXISTS customer_invoices (
  invoice_id        SERIAL PRIMARY KEY,
  invoice_number    VARCHAR(50) NOT NULL UNIQUE,
  customer_id       INT NOT NULL REFERENCES customers(customer_id),
  invoice_month     INT NOT NULL CHECK (invoice_month BETWEEN 1 AND 12),
  invoice_year      INT NOT NULL,
  invoice_date      DATE NOT NULL,
  from_date         DATE NOT NULL,
  to_date           DATE NOT NULL,
  line_items        JSONB NOT NULL DEFAULT '[]',
  subtotal          NUMERIC(12,2) DEFAULT 0,
  gst_percent       NUMERIC(5,2)  DEFAULT 18,
  gst_amount        NUMERIC(12,2) DEFAULT 0,
  credit_note_adjustment NUMERIC(12,2) DEFAULT 0,
  security_deposit  NUMERIC(12,2) DEFAULT 0,
  grand_total       NUMERIC(12,2) DEFAULT 0,
  status            VARCHAR(20) DEFAULT 'draft'
    CHECK (status IN ('draft','sent','paid','overdue','cancelled')),
  irn               VARCHAR(100),
  irn_generated_at  TIMESTAMPTZ,
  qr_code_url       TEXT,
  signed_qr_code    TEXT,
  eway_bill_number  VARCHAR(50),
  eway_bill_valid_till TIMESTAMPTZ,
  pdf_path          TEXT,
  sent_at           TIMESTAMPTZ,
  sent_by           INT REFERENCES users(user_id),
  paid_at           TIMESTAMPTZ,
  payment_reference VARCHAR(100),
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(customer_id, invoice_month, invoice_year)
);
CREATE INDEX IF NOT EXISTS idx_customer_invoices_customer
  ON customer_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_invoices_status
  ON customer_invoices(status);
CREATE INDEX IF NOT EXISTS idx_customer_invoices_month_year
  ON customer_invoices(invoice_year, invoice_month);

CREATE TABLE IF NOT EXISTS customer_credit_notes (
  credit_note_id     SERIAL PRIMARY KEY,
  credit_note_number VARCHAR(50) NOT NULL UNIQUE,
  customer_id        INT NOT NULL REFERENCES customers(customer_id),
  invoice_id         INT REFERENCES customer_invoices(invoice_id),
  reason             VARCHAR(255) NOT NULL,
  description        TEXT,
  amount             NUMERIC(12,2) NOT NULL DEFAULT 0,
  quantity           INT DEFAULT 0,
  unit_rate          NUMERIC(12,2) DEFAULT 0,
  from_date          DATE,
  to_date            DATE,
  ttspl_ids          JSONB DEFAULT '[]',
  status             VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending','approved','applied','cancelled')),
  applied_in_invoice_id INT REFERENCES customer_invoices(invoice_id),
  created_by         INT REFERENCES users(user_id),
  approved_by        INT REFERENCES users(user_id),
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_credit_notes_customer
  ON customer_credit_notes(customer_id);

CREATE TABLE IF NOT EXISTS customer_security_deposits (
  deposit_id         SERIAL PRIMARY KEY,
  customer_id        INT NOT NULL REFERENCES customers(customer_id),
  sales_order_number VARCHAR(50),
  amount             NUMERIC(12,2) NOT NULL,
  received_date      DATE NOT NULL,
  status             VARCHAR(20) DEFAULT 'held'
    CHECK (status IN ('held','partially_refunded','refunded','adjusted')),
  refund_amount      NUMERIC(12,2) DEFAULT 0,
  refund_date        DATE,
  refund_reference   VARCHAR(100),
  notes              TEXT,
  created_by         INT REFERENCES users(user_id),
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS einvoice_records (
  record_id          SERIAL PRIMARY KEY,
  dc_number          VARCHAR(50) NOT NULL,
  invoice_id         INT REFERENCES customer_invoices(invoice_id),
  customer_id        INT REFERENCES customers(customer_id),
  invoice_number     VARCHAR(50),
  irn                VARCHAR(100) UNIQUE,
  ack_number         VARCHAR(100),
  ack_date           TIMESTAMPTZ,
  signed_invoice     TEXT,
  signed_qr_code     TEXT,
  qr_code_image_url  TEXT,
  status             VARCHAR(20) DEFAULT 'generated'
    CHECK (status IN ('generated','cancelled')),
  cancelled_at       TIMESTAMPTZ,
  cancel_reason      VARCHAR(255),
  zoho_response      JSONB,
  generated_by         INT REFERENCES users(user_id),
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_einvoice_dc
  ON einvoice_records(dc_number);

CREATE TABLE IF NOT EXISTS eway_bill_records (
  record_id          SERIAL PRIMARY KEY,
  dc_number          VARCHAR(50) NOT NULL,
  ewb_number         VARCHAR(50) UNIQUE,
  ewb_date           TIMESTAMPTZ,
  valid_upto         TIMESTAMPTZ,
  transporter_id     VARCHAR(50),
  transporter_name   VARCHAR(100),
  vehicle_number     VARCHAR(20),
  mode_of_transport  VARCHAR(20) DEFAULT 'road',
  distance_km        INT,
  status             VARCHAR(20) DEFAULT 'active'
    CHECK (status IN ('active','extended','cancelled')),
  zoho_response      JSONB,
  generated_by       INT REFERENCES users(user_id),
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO sm_document_sequences (doc_type, last_value, prefix)
VALUES
  ('customer_invoice', 0, 'INV-'),
  ('credit_note',      0, 'CN-')
ON CONFLICT (doc_type) DO NOTHING;

INSERT INTO permission_sections (section, description, sort_order)
VALUES
  ('customer_billing',    'Customer Billing & Invoices',    200),
  ('vendor_billing_mgmt', 'Vendor Billing Management',      201),
  ('credit_notes',        'Customer Credit Notes',          202),
  ('debit_notes',         'Vendor Debit Notes',             203),
  ('security_deposits',   'Security Deposits',              204),
  ('billing_dashboard',   'Billing Dashboard & Reports',    205)
ON CONFLICT (section) DO UPDATE SET
  description = EXCLUDED.description,
  sort_order  = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin',   'customer_billing',    TRUE,TRUE,TRUE,TRUE),
  ('manager', 'customer_billing',    TRUE,TRUE,TRUE,FALSE),
  ('accounts','customer_billing',    TRUE,TRUE,TRUE,FALSE),
  ('sales',   'customer_billing',    TRUE,FALSE,FALSE,FALSE),
  ('admin',   'vendor_billing_mgmt', TRUE,TRUE,TRUE,TRUE),
  ('manager', 'vendor_billing_mgmt', TRUE,TRUE,TRUE,FALSE),
  ('accounts','vendor_billing_mgmt', TRUE,TRUE,TRUE,FALSE),
  ('admin',   'credit_notes',        TRUE,TRUE,TRUE,TRUE),
  ('manager', 'credit_notes',        TRUE,TRUE,TRUE,FALSE),
  ('accounts','credit_notes',        TRUE,TRUE,FALSE,FALSE),
  ('admin',   'debit_notes',         TRUE,TRUE,TRUE,TRUE),
  ('manager', 'debit_notes',         TRUE,TRUE,TRUE,FALSE),
  ('accounts','debit_notes',         TRUE,TRUE,FALSE,FALSE),
  ('admin',   'security_deposits',   TRUE,TRUE,TRUE,TRUE),
  ('manager', 'security_deposits',   TRUE,TRUE,TRUE,FALSE),
  ('accounts','security_deposits',   TRUE,TRUE,TRUE,FALSE),
  ('admin',   'billing_dashboard',   TRUE,FALSE,FALSE,FALSE),
  ('manager', 'billing_dashboard',   TRUE,FALSE,FALSE,FALSE),
  ('accounts','billing_dashboard',   TRUE,FALSE,FALSE,FALSE)
ON CONFLICT (role, section) DO NOTHING;
