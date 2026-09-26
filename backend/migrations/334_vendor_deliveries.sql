-- Procure to stock, step 5 (gate arrival and receiving).
--
-- D4: the guard logs each vendor delivery at the gate BEFORE anything is
--     received, so "arrived" and "received" cannot drift apart.
-- D7: one GRN per delivery (receipts used to pile onto the PO's last GRN),
--     carrying the vendor's challan and invoice numbers.
-- D5: a laptop received without the configuration check (it will not power
--     on) waits for a manager to approve the waiver.
-- D6: a wrong or dead-on-arrival laptop is received for traceability, marked
--     rejected at receipt, kept out of vendor billing and the PO's received
--     count, and goes back to the vendor.
CREATE TABLE IF NOT EXISTS vendor_deliveries (
  delivery_id SERIAL PRIMARY KEY,
  delivery_number VARCHAR(32) UNIQUE,
  po_id INT NOT NULL REFERENCES vendor_purchase_orders(po_id),
  vendor_id INT REFERENCES vendors(vendor_id) ON DELETE SET NULL,
  vendor_challan_no VARCHAR(100),
  vendor_invoice_no VARCHAR(100),
  laptop_count INT NOT NULL CHECK (laptop_count > 0),
  carrier_name VARCHAR(255),
  vehicle_no VARCHAR(50),
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'arrived'
    CHECK (status IN ('arrived', 'receiving', 'received', 'cancelled')),
  grn_id INT REFERENCES vendor_goods_received_notes(grn_id) ON DELETE SET NULL,
  arrived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  logged_by INT REFERENCES users(user_id) ON DELETE SET NULL,
  completed_at TIMESTAMPTZ,
  completed_by INT REFERENCES users(user_id) ON DELETE SET NULL,
  completion_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vendor_deliveries_po ON vendor_deliveries (po_id);
CREATE INDEX IF NOT EXISTS idx_vendor_deliveries_status ON vendor_deliveries (status);

ALTER TABLE vendor_goods_received_notes
  ADD COLUMN IF NOT EXISTS delivery_id INT REFERENCES vendor_deliveries(delivery_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vendor_challan_no VARCHAR(100),
  ADD COLUMN IF NOT EXISTS vendor_invoice_no VARCHAR(100);

ALTER TABLE vendor_serial_numbers
  ADD COLUMN IF NOT EXISTS rejected_at_receipt BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS receipt_rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS waiver_approved_by INT REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS waiver_approved_at TIMESTAMPTZ;
