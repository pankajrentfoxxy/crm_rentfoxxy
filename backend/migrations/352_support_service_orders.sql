-- 352: gorefurbo service order (SVO/yy-yy/nnnn) for out-of-warranty service on
-- sold laptops (claude/carret-lockin-warranty.md, W2).
--
-- Deliberately NOT sales_order_lines: ~100 queries read that table as "laptops
-- to buy / attach / dispatch", and a service bill has no laptop. Accounts raise
-- the invoice in Zoho and attach it here, like an in-place sale.

CREATE TABLE IF NOT EXISTS support_service_orders (
  id                   SERIAL PRIMARY KEY,
  order_number         VARCHAR(40) NOT NULL UNIQUE,
  customer_id          INTEGER NOT NULL,
  customer_name        TEXT,
  gst_number           VARCHAR(30),
  billing_address      TEXT,
  supply_state         VARCHAR(80),
  entity_code          VARCHAR(20) NOT NULL DEFAULT 'gorefurbo',
  subtotal             NUMERIC(12,2) NOT NULL DEFAULT 0,
  gst_type             VARCHAR(10),
  cgst                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  sgst                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  igst                 NUMERIC(12,2) NOT NULL DEFAULT 0,
  grand_total          NUMERIC(12,2) NOT NULL DEFAULT 0,
  status               VARCHAR(20) NOT NULL DEFAULT 'awaiting_invoice'
                         CHECK (status IN ('awaiting_invoice','invoiced','cancelled')),
  invoice_number       VARCHAR(80),
  invoice_pdf_path     TEXT,
  invoice_uploaded_at  TIMESTAMPTZ,
  invoice_uploaded_by  INTEGER,
  created_by           INTEGER,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_support_service_orders_customer ON support_service_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_support_service_orders_status ON support_service_orders(status);

ALTER TABLE support_service_charges
  ADD COLUMN IF NOT EXISTS service_order_id INTEGER REFERENCES support_service_orders(id);
-- 350 named it sales_order_number before the SVO document existed; nothing has used it.
ALTER TABLE support_service_charges DROP COLUMN IF EXISTS sales_order_number;

INSERT INTO sm_document_sequences (doc_type, last_value, prefix)
VALUES ('service_order', 0, 'SVO-')
ON CONFLICT (doc_type) DO NOTHING;
