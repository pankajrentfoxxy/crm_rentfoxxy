-- ============================================================================
-- Migration 074 — Foundation: inventory state machine, company/entity model,
--                 KYC + demo lifecycle, customer_inventory deprecation.
--
-- This is the schema foundation the audit-and-harden build depends on.
-- It is additive and idempotent (IF NOT EXISTS / ON CONFLICT) — no drops.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. COMPANY / LEGAL ENTITY REGISTRY  (Rentfoxxy vs Gorefurbo)
--    Rental + Demo  -> rentfoxxy   |   Sales -> gorefurbo
--    Each entity has its own GSTIN and its own DC / invoice number series.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
  company_id     SERIAL PRIMARY KEY,
  code           VARCHAR(20) NOT NULL UNIQUE,         -- 'rentfoxxy' | 'gorefurbo'
  legal_name     VARCHAR(255) NOT NULL,
  gstin          VARCHAR(20),
  pan            VARCHAR(20),
  address        TEXT,
  state_code     VARCHAR(4),
  hsn_code       VARCHAR(20) DEFAULT '84713000',
  logo_url       TEXT,
  dc_prefix      VARCHAR(12) NOT NULL,                -- e.g. 'DC-'  / 'GDC-'
  invoice_prefix VARCHAR(12) NOT NULL,                -- e.g. 'INV-' / 'GINV-'
  active         BOOLEAN DEFAULT TRUE,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO companies (code, legal_name, dc_prefix, invoice_prefix, hsn_code)
VALUES
  ('rentfoxxy', 'Rentfoxxy Technologies Pvt Ltd', 'DC-',  'INV-',  '84713000'),
  ('gorefurbo', 'Gorefurbo',                      'GDC-', 'GINV-', '84713000')
ON CONFLICT (code) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2. PER-ENTITY DOCUMENT NUMBER SEQUENCES
--    Existing shared sequences stay for backward compatibility; new
--    entity-scoped sequences drive all NEW documents.
-- ----------------------------------------------------------------------------
INSERT INTO sm_document_sequences (doc_type, last_value, prefix)
VALUES
  ('dc_rentfoxxy',      0, 'DC-'),
  ('dc_gorefurbo',      0, 'GDC-'),
  ('invoice_rentfoxxy', 0, 'INV-'),
  ('invoice_gorefurbo', 0, 'GINV-'),
  ('so_rentfoxxy',      0, 'SO-'),
  ('so_gorefurbo',      0, 'GSO-'),
  ('quote_rentfoxxy',   0, 'EST-'),
  ('quote_gorefurbo',   0, 'GEST-')
ON CONFLICT (doc_type) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. TAG SALES DOCUMENTS WITH ENTITY
--    entity_code is derived from quotation_type:
--      'sales' -> gorefurbo, else ('rental' / 'demo') -> rentfoxxy.
-- ----------------------------------------------------------------------------
ALTER TABLE sales_quotations      ADD COLUMN IF NOT EXISTS entity_code VARCHAR(20);
ALTER TABLE sales_order_lines     ADD COLUMN IF NOT EXISTS entity_code VARCHAR(20);
ALTER TABLE delivery_challan_lines ADD COLUMN IF NOT EXISTS entity_code VARCHAR(20);
ALTER TABLE customer_invoices     ADD COLUMN IF NOT EXISTS entity_code VARCHAR(20);

-- Backfill from quotation_type where present.
UPDATE sales_quotations
   SET entity_code = CASE WHEN LOWER(COALESCE(quotation_type,'rental'))='sales'
                          THEN 'gorefurbo' ELSE 'rentfoxxy' END
 WHERE entity_code IS NULL;

UPDATE sales_order_lines
   SET entity_code = CASE WHEN LOWER(COALESCE(quotation_type,'rental'))='sales'
                          THEN 'gorefurbo' ELSE 'rentfoxxy' END
 WHERE entity_code IS NULL;

UPDATE delivery_challan_lines dcl
   SET entity_code = CASE WHEN LOWER(COALESCE(
                              (SELECT sol.quotation_type FROM sales_order_lines sol
                                WHERE sol.sales_order_number = dcl.sales_order_number
                                LIMIT 1),'rental'))='sales'
                          THEN 'gorefurbo' ELSE 'rentfoxxy' END
 WHERE entity_code IS NULL;

UPDATE customer_invoices SET entity_code = 'rentfoxxy' WHERE entity_code IS NULL;

-- ----------------------------------------------------------------------------
-- 4. CANONICAL INVENTORY STATE MACHINE on vendor_serial_numbers
--    Canonical inventory_status values (VARCHAR(64), enforced in app layer):
--      in_stock  -> reserved -> in_transit -> rented | on_demo | sold
--                -> returned -> (QC) -> in_stock
--      plus: in_repair, qc_failed, scrapped
--    Promote billing/holding anchors out of `extra` jsonb into real columns.
-- ----------------------------------------------------------------------------
ALTER TABLE vendor_serial_numbers
  ADD COLUMN IF NOT EXISTS current_customer_id INT REFERENCES customers(customer_id),
  ADD COLUMN IF NOT EXISTS current_dc_number   VARCHAR(50),
  ADD COLUMN IF NOT EXISTS current_entity      VARCHAR(20),   -- rentfoxxy | gorefurbo
  ADD COLUMN IF NOT EXISTS dispatch_mode       VARCHAR(20),   -- inhouse | porter | courier
  ADD COLUMN IF NOT EXISTS dispatched_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS returned_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rent_start_date     DATE,          -- billing anchor (see rent-start rule)
  ADD COLUMN IF NOT EXISTS rent_end_date       DATE,
  ADD COLUMN IF NOT EXISTS rent_monthly_rate   NUMERIC(12,2),  -- agreed monthly rate, captured at delivery
  ADD COLUMN IF NOT EXISTS status_changed_at   TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_vsn_current_customer
  ON vendor_serial_numbers (current_customer_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vsn_status_entity
  ON vendor_serial_numbers (inventory_status, current_entity) WHERE deleted_at IS NULL;

-- Asset status transition audit (complements ttspl event log; raw status moves).
CREATE TABLE IF NOT EXISTS inventory_status_transitions (
  transition_id  SERIAL PRIMARY KEY,
  serial_id      INT REFERENCES vendor_serial_numbers(serial_id) ON DELETE CASCADE,
  ttspl_id       VARCHAR(64),
  from_status    VARCHAR(64),
  to_status      VARCHAR(64) NOT NULL,
  reason         VARCHAR(255),
  dc_number      VARCHAR(50),
  customer_id    INT,
  entity_code    VARCHAR(20),
  actor_user_id  INT REFERENCES users(user_id),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_inv_status_trans_serial
  ON inventory_status_transitions (serial_id);

-- ----------------------------------------------------------------------------
-- 5. CUSTOMER KYC  (mandatory before a Demo dispatch)
-- ----------------------------------------------------------------------------
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS kyc_status        VARCHAR(20) DEFAULT 'pending'
      CHECK (kyc_status IN ('pending','submitted','verified','rejected')),
  ADD COLUMN IF NOT EXISTS kyc_verified_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kyc_verified_by   INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS kyc_documents     JSONB DEFAULT '[]'::jsonb;

-- ----------------------------------------------------------------------------
-- 6. DEMO LIFECYCLE
--    A demo unit goes out free; at delivery+7d the customer decides keep/return.
--    Keep -> convert to rental with an agreed billing-start date.
--    Return -> support pickup ticket; unit re-enters inventory after QC.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demo_agreements (
  demo_id            SERIAL PRIMARY KEY,
  sales_order_number VARCHAR(50),
  dc_number          VARCHAR(50),
  customer_id        INT NOT NULL REFERENCES customers(customer_id),
  serial_id          INT REFERENCES vendor_serial_numbers(serial_id),
  ttspl_id           VARCHAR(64),
  delivered_at       TIMESTAMPTZ,
  decision_due_at    TIMESTAMPTZ,                 -- delivered_at + 7 days
  decision           VARCHAR(20) DEFAULT 'pending'
      CHECK (decision IN ('pending','keep','return')),
  decided_at         TIMESTAMPTZ,
  decided_by         INT REFERENCES users(user_id),
  rent_start_date    DATE,                        -- agreed start if kept
  pickup_ticket_id   INT,                         -- support ticket if returned
  notes              TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_demo_agreements_decision
  ON demo_agreements (decision, decision_due_at);

-- ----------------------------------------------------------------------------
-- 7. DEPRECATE customer_inventory
--    Retained read-only for historical reference; no longer a source of truth.
--    "Assets with customer" is now derived from vendor_serial_numbers.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_name = 'customer_inventory') THEN
    EXECUTE 'ALTER TABLE customer_inventory ADD COLUMN IF NOT EXISTS deprecated BOOLEAN DEFAULT TRUE';
    EXECUTE 'COMMENT ON TABLE customer_inventory IS ''DEPRECATED 2026-06: ERP-era table. Customer holdings now derived from vendor_serial_numbers. Read-only / historical.''';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 8. NEW PERMISSION SECTIONS for new surfaces
-- ----------------------------------------------------------------------------
INSERT INTO permission_sections (section, description, sort_order)
VALUES
  ('customer_assets', 'Customer Assets (held inventory)', 86),
  ('kyc_management',  'Customer KYC',                     87),
  ('demo_management', 'Demo Agreements',                  56),
  ('company_settings','Company / Entity Settings',       360)
ON CONFLICT (section) DO UPDATE SET description = EXCLUDED.description;

-- Default role grants for the new sections (super_admin is always allowed in code).
INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin','customer_assets',TRUE,FALSE,FALSE,FALSE),
  ('manager','customer_assets',TRUE,FALSE,FALSE,FALSE),
  ('sales','customer_assets',TRUE,FALSE,FALSE,FALSE),
  ('support_lead','customer_assets',TRUE,FALSE,FALSE,FALSE),
  ('support_tech','customer_assets',TRUE,FALSE,FALSE,FALSE),
  ('accounts','customer_assets',TRUE,FALSE,FALSE,FALSE),
  ('admin','kyc_management',TRUE,TRUE,TRUE,FALSE),
  ('manager','kyc_management',TRUE,TRUE,TRUE,FALSE),
  ('sales','kyc_management',TRUE,TRUE,TRUE,FALSE),
  ('admin','demo_management',TRUE,TRUE,TRUE,FALSE),
  ('manager','demo_management',TRUE,TRUE,TRUE,FALSE),
  ('sales','demo_management',TRUE,TRUE,TRUE,FALSE),
  ('accounts','demo_management',TRUE,FALSE,FALSE,FALSE),
  ('admin','company_settings',TRUE,TRUE,TRUE,FALSE),
  ('manager','company_settings',TRUE,FALSE,FALSE,FALSE)
ON CONFLICT (role, section) DO NOTHING;
