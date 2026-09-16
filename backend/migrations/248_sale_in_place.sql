-- ============================================================
-- Migration 248: Sale in Place (lost / damaged / buyout rental laptops)
--
-- A customer keeps a laptop they hold on rent. Rent stops, the unused prepaid
-- portion is credited, and the unit is sold to them WHERE IT ALREADY IS.
-- No Delivery Challan and no e-way bill: the goods never move.
--
-- NOTE ON VENDOR-RENTED UNITS: purchase_order_type lives on
-- vendor_purchase_orders and is shared by every serial on that PO (PO-0009 has
-- 451). It must NEVER be flipped to convert a single laptop -- that would drop
-- every other rented serial out of generateVendorBill. Ownership is instead
-- recorded per serial via vendor_serial_numbers.acquisition_type, which shadows
-- the PO type. Stopping the vendor rent is a separate lever:
-- vendor_serial_numbers.vendor_rent_end_date, already honoured per serial.
--
-- Idempotent.
-- ============================================================
BEGIN;

-- 1. Sales orders that fulfil without a movement ------------------------------
ALTER TABLE sales_order_lines
  ADD COLUMN IF NOT EXISTS fulfillment_mode VARCHAR(16) NOT NULL DEFAULT 'dispatch';

ALTER TABLE sales_order_lines
  DROP CONSTRAINT IF EXISTS sol_fulfillment_mode_chk;
ALTER TABLE sales_order_lines
  ADD CONSTRAINT sol_fulfillment_mode_chk
  CHECK (fulfillment_mode IN ('dispatch', 'in_place'));

CREATE INDEX IF NOT EXISTS idx_sol_fulfillment_in_place
  ON sales_order_lines (sales_order_number)
  WHERE fulfillment_mode = 'in_place';

-- 2. Accounts attach the Zoho invoice against the SO --------------------------
--    Mirrors migration 171 (sale DC compliance) so the two flows look alike.
ALTER TABLE sales_order_lines
  ADD COLUMN IF NOT EXISTS sale_invoice_number      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS sale_invoice_pdf_path    TEXT,
  ADD COLUMN IF NOT EXISTS sale_invoice_uploaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sale_invoice_uploaded_by INT REFERENCES users(user_id);

CREATE INDEX IF NOT EXISTS idx_sol_sale_invoice_pending
  ON sales_order_lines (sales_order_number)
  WHERE fulfillment_mode = 'in_place' AND sale_invoice_number IS NULL;

-- 3. Per-serial ownership override --------------------------------------------
--    Effective type = COALESCE(vsn.acquisition_type, vpo.purchase_order_type).
ALTER TABLE vendor_serial_numbers
  ADD COLUMN IF NOT EXISTS acquisition_type      VARCHAR(24),
  ADD COLUMN IF NOT EXISTS vendor_buyout_bill_no VARCHAR(50),
  ADD COLUMN IF NOT EXISTS vendor_buyout_amount  NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS vendor_buyout_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vendor_buyout_by      INT REFERENCES users(user_id);

ALTER TABLE vendor_serial_numbers
  DROP CONSTRAINT IF EXISTS vsn_acquisition_type_chk;
ALTER TABLE vendor_serial_numbers
  ADD CONSTRAINT vsn_acquisition_type_chk
  CHECK (acquisition_type IS NULL OR acquisition_type IN
    ('direct_purchase', 'rental_purchase', 'rent_to_own'));

-- 4. The case record -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS sale_in_place_events (
  event_id           SERIAL PRIMARY KEY,
  serial_id          INT NOT NULL REFERENCES vendor_serial_numbers(serial_id),
  customer_id        INT NOT NULL REFERENCES customers(customer_id),
  reason             VARCHAR(16) NOT NULL
                       CHECK (reason IN ('lost', 'damaged', 'buyout')),
  reported_on        DATE NOT NULL,
  rent_stopped_on    DATE NOT NULL,
  sales_order_number VARCHAR(50),
  credit_note_id     INT,
  vendor_id          INT REFERENCES vendors(vendor_id),
  vendor_settled     BOOLEAN NOT NULL DEFAULT FALSE,
  notes              TEXT,
  created_by         INT REFERENCES users(user_id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One open case per asset at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_sale_in_place_open
  ON sale_in_place_events (serial_id)
  WHERE sales_order_number IS NULL;

CREATE INDEX IF NOT EXISTS idx_sale_in_place_customer
  ON sale_in_place_events (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sale_in_place_so
  ON sale_in_place_events (sales_order_number)
  WHERE sales_order_number IS NOT NULL;

-- Procurement worklist: vendor-rented units awaiting a buyout bill.
CREATE INDEX IF NOT EXISTS idx_sale_in_place_vendor_unsettled
  ON sale_in_place_events (vendor_id)
  WHERE vendor_id IS NOT NULL AND vendor_settled = FALSE;

COMMIT;
