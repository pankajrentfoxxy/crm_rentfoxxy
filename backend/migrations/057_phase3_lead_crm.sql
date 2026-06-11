-- Phase 3: Lead CRM enhancements, customer profile enrichment,
-- follow-up improvements, lead conversion tracking

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS whatsapp_number    VARCHAR(32),
  ADD COLUMN IF NOT EXISTS designation        VARCHAR(255),
  ADD COLUMN IF NOT EXISTS quantity_required  INT,
  ADD COLUMN IF NOT EXISTS monthly_budget     NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS rental_duration    INT,
  ADD COLUMN IF NOT EXISTS use_case           VARCHAR(100),
  ADD COLUMN IF NOT EXISTS company_type       VARCHAR(100),
  ADD COLUMN IF NOT EXISTS company_size       INT,
  ADD COLUMN IF NOT EXISTS industry           VARCHAR(100),
  ADD COLUMN IF NOT EXISTS annual_revenue     VARCHAR(100),
  ADD COLUMN IF NOT EXISTS pan_number         VARCHAR(20),
  ADD COLUMN IF NOT EXISTS gst_number         VARCHAR(20),
  ADD COLUMN IF NOT EXISTS state              VARCHAR(100),
  ADD COLUMN IF NOT EXISTS pincode            VARCHAR(10),
  ADD COLUMN IF NOT EXISTS billing_address    TEXT,
  ADD COLUMN IF NOT EXISTS shipping_same_as_billing BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS shipping_address   TEXT,
  ADD COLUMN IF NOT EXISTS follow_up_time     TIME,
  ADD COLUMN IF NOT EXISTS converted_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS converted_by       INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS customer_id        INT REFERENCES customers(customer_id),
  ADD COLUMN IF NOT EXISTS inquiry_type       VARCHAR(50) DEFAULT 'rental',
  ADD COLUMN IF NOT EXISTS last_activity_at   TIMESTAMPTZ DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'leads_inquiry_type_check'
  ) THEN
    ALTER TABLE leads ADD CONSTRAINT leads_inquiry_type_check
      CHECK (inquiry_type IN ('rental', 'sales', 'both'));
  END IF;
END $$;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS pan_number          VARCHAR(20),
  ADD COLUMN IF NOT EXISTS company_type        VARCHAR(100),
  ADD COLUMN IF NOT EXISTS company_size        INT,
  ADD COLUMN IF NOT EXISTS industry            VARCHAR(100),
  ADD COLUMN IF NOT EXISTS billing_address     TEXT,
  ADD COLUMN IF NOT EXISTS billing_city        VARCHAR(100),
  ADD COLUMN IF NOT EXISTS billing_state       VARCHAR(100),
  ADD COLUMN IF NOT EXISTS billing_pincode     VARCHAR(10),
  ADD COLUMN IF NOT EXISTS shipping_same       BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS shipping_address    TEXT,
  ADD COLUMN IF NOT EXISTS shipping_city       VARCHAR(100),
  ADD COLUMN IF NOT EXISTS shipping_state      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS shipping_pincode    VARCHAR(10),
  ADD COLUMN IF NOT EXISTS whatsapp_number     VARCHAR(32),
  ADD COLUMN IF NOT EXISTS designation         VARCHAR(255),
  ADD COLUMN IF NOT EXISTS source_lead_stage   VARCHAR(100),
  ADD COLUMN IF NOT EXISTS onboarded_by        INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS onboarded_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS portal_enabled      BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS notes               TEXT,
  ADD COLUMN IF NOT EXISTS kyc_verified        BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS kyc_verified_by     INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS kyc_verified_at     TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS customer_documents (
  doc_id          SERIAL PRIMARY KEY,
  customer_id     INT NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
  lead_id         INT REFERENCES leads(lead_id) ON DELETE SET NULL,
  doc_type        VARCHAR(50) NOT NULL
    CHECK (doc_type IN ('gst_certificate','pan_card','agreement','kyc_id','other')),
  doc_label       VARCHAR(255),
  file_path       TEXT NOT NULL,
  file_name       VARCHAR(255),
  file_size_bytes INT,
  uploaded_by     INT REFERENCES users(user_id),
  is_signed       BOOLEAN DEFAULT FALSE,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customer_docs_customer
  ON customer_documents(customer_id);

CREATE TABLE IF NOT EXISTS lead_import_logs (
  import_id     SERIAL PRIMARY KEY,
  imported_by   INT REFERENCES users(user_id),
  total_rows    INT DEFAULT 0,
  imported      INT DEFAULT 0,
  duplicates    INT DEFAULT 0,
  errors        INT DEFAULT 0,
  error_details JSONB DEFAULT '[]',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_lead_last_activity()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE leads SET last_activity_at = NOW()
  WHERE lead_id = NEW.lead_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lead_last_activity ON lead_activities;
CREATE TRIGGER trg_lead_last_activity
  AFTER INSERT ON lead_activities
  FOR EACH ROW EXECUTE FUNCTION update_lead_last_activity();

INSERT INTO permission_sections (section, description, sort_order)
VALUES
  ('lead_conversion', 'Lead to Customer Conversion', 45),
  ('customer_documents', 'Customer Documents', 85)
ON CONFLICT (section) DO UPDATE SET
  description = EXCLUDED.description,
  sort_order  = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin',   'lead_conversion',    TRUE,TRUE,TRUE,TRUE),
  ('manager', 'lead_conversion',    TRUE,TRUE,TRUE,FALSE),
  ('sales',   'lead_conversion',    TRUE,TRUE,FALSE,FALSE),
  ('admin',   'customer_documents', TRUE,TRUE,TRUE,TRUE),
  ('manager', 'customer_documents', TRUE,TRUE,TRUE,FALSE),
  ('sales',   'customer_documents', TRUE,TRUE,FALSE,FALSE),
  ('accounts','customer_documents', TRUE,FALSE,FALSE,FALSE)
ON CONFLICT (role, section) DO NOTHING;
