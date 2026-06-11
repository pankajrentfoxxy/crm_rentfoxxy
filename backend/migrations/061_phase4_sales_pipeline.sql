-- Phase 4: Sales pipeline — QC enforcement, payments, dispatch tracking

ALTER TABLE delivery_challan_lines
  ADD COLUMN IF NOT EXISTS dispatch_mode       VARCHAR(20) DEFAULT 'courier',
  ADD COLUMN IF NOT EXISTS porter_booking_id   VARCHAR(100),
  ADD COLUMN IF NOT EXISTS estimated_delivery  DATE,
  ADD COLUMN IF NOT EXISTS pre_dispatch_qc_ticket_id INT REFERENCES tickets(ticket_id),
  ADD COLUMN IF NOT EXISTS pre_dispatch_qc_passed BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS irn                 VARCHAR(100),
  ADD COLUMN IF NOT EXISTS irn_generated_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS qr_code_url         TEXT,
  ADD COLUMN IF NOT EXISTS eway_bill_number    VARCHAR(50),
  ADD COLUMN IF NOT EXISTS eway_bill_valid_till TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invoice_sent_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invoice_sent_by     INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS delivered_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_by        INT REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS delivery_location   TEXT,
  ADD COLUMN IF NOT EXISTS delivery_otp        VARCHAR(10),
  ADD COLUMN IF NOT EXISTS delivery_otp_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pod_image_url       TEXT,
  ADD COLUMN IF NOT EXISTS rejection_reason    TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'delivery_challan_lines_dispatch_mode_check') THEN
    ALTER TABLE delivery_challan_lines ADD CONSTRAINT delivery_challan_lines_dispatch_mode_check
      CHECK (dispatch_mode IN ('courier','porter','inhouse'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS sales_order_payments (
  payment_id         SERIAL PRIMARY KEY,
  sales_order_number VARCHAR(50) NOT NULL,
  customer_id        INT REFERENCES customers(customer_id),
  payment_type       VARCHAR(30) NOT NULL
    CHECK (payment_type IN ('advance','security_deposit','monthly','partial','final')),
  amount             NUMERIC(12,2) NOT NULL,
  payment_date       DATE NOT NULL,
  payment_mode       VARCHAR(30) DEFAULT 'bank_transfer'
    CHECK (payment_mode IN ('bank_transfer','cheque','upi','cash','other')),
  reference_number   VARCHAR(100),
  notes              TEXT,
  recorded_by        INT REFERENCES users(user_id),
  created_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_so_payments_so ON sales_order_payments (sales_order_number);

CREATE TABLE IF NOT EXISTS dc_qc_tickets (
  id                 SERIAL PRIMARY KEY,
  dc_number          VARCHAR(50) NOT NULL,
  sales_order_number VARCHAR(50),
  ticket_id          INT NOT NULL REFERENCES tickets(ticket_id),
  ttspl_id           VARCHAR(50),
  serial_id          INT REFERENCES vendor_serial_numbers(serial_id),
  status             VARCHAR(20) DEFAULT 'pending'
    CHECK (status IN ('pending','qc_passed','qc_failed')),
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dc_qc_tickets_dc ON dc_qc_tickets (dc_number);

INSERT INTO permission_sections (section, description, sort_order)
VALUES
  ('sales_pipeline',  'Sales Pipeline (Quotations, SOs, DCs)', 55),
  ('payment_records', 'Payment Recording', 56),
  ('einvoice_ewb',    'E-Invoice and E-Way Bill', 57),
  ('dispatch_ops',    'Dispatch Operations', 175)
ON CONFLICT (section) DO UPDATE SET
  description = EXCLUDED.description,
  sort_order  = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin',    'sales_pipeline',  TRUE,TRUE,TRUE,TRUE),
  ('manager',  'sales_pipeline',  TRUE,TRUE,TRUE,FALSE),
  ('sales',    'sales_pipeline',  TRUE,TRUE,FALSE,FALSE),
  ('warehouse','sales_pipeline',  TRUE,FALSE,TRUE,FALSE),
  ('dispatch', 'sales_pipeline',  TRUE,FALSE,TRUE,FALSE),
  ('admin',    'payment_records', TRUE,TRUE,TRUE,TRUE),
  ('manager',  'payment_records', TRUE,TRUE,TRUE,FALSE),
  ('accounts', 'payment_records', TRUE,TRUE,TRUE,FALSE),
  ('admin',    'einvoice_ewb',    TRUE,TRUE,TRUE,FALSE),
  ('accounts', 'einvoice_ewb',    TRUE,TRUE,FALSE,FALSE),
  ('dispatch', 'einvoice_ewb',    TRUE,FALSE,FALSE,FALSE),
  ('admin',    'dispatch_ops',    TRUE,TRUE,TRUE,TRUE),
  ('manager',  'dispatch_ops',    TRUE,FALSE,TRUE,FALSE),
  ('dispatch', 'dispatch_ops',    TRUE,FALSE,TRUE,FALSE),
  ('warehouse','dispatch_ops',    TRUE,FALSE,TRUE,FALSE)
ON CONFLICT (role, section) DO NOTHING;
