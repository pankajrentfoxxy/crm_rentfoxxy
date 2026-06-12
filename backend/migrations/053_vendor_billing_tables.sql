-- Vendor debit notes (for faulty unit adjustments)
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

-- Vendor monthly bills (auto-calculated on last day of month)
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
