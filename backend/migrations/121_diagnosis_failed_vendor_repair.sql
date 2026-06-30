-- Diagnosis Failed → Vendor Out-for-Repair workflow

ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_status_check;
ALTER TABLE tickets ADD CONSTRAINT tickets_status_check
  CHECK (status IN (
    'in_progress', 'completed', 'failed', 'on_hold',
    'qc_failed_return_vendor', 'cancelled',
    'diagnosis_failed', 'out_for_repair'
  ));

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS diagnosis_failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS diagnosis_failed_reason TEXT,
  ADD COLUMN IF NOT EXISTS diagnosis_failed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS previous_technician_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS previous_stage_id INTEGER REFERENCES stages(stage_id),
  ADD COLUMN IF NOT EXISTS vendor_repair_dc_number VARCHAR(64),
  ADD COLUMN IF NOT EXISTS current_location VARCHAR(128);

CREATE TABLE IF NOT EXISTS vendor_repair_delivery_challans (
  id SERIAL PRIMARY KEY,
  dc_number VARCHAR(64) UNIQUE NOT NULL,
  vendor_id INTEGER REFERENCES vendors(vendor_id) ON DELETE SET NULL,
  vendor_name VARCHAR(255),
  vendor_address TEXT,
  contact_person VARCHAR(255),
  contact_mobile VARCHAR(50),
  expected_return_date DATE,
  remarks TEXT,
  warehouse_name VARCHAR(255),
  warehouse_address TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  out_date DATE DEFAULT CURRENT_DATE,
  warehouse_dispatch_esign_url TEXT,
  vendor_dispatch_esign_url TEXT,
  warehouse_return_esign_url TEXT,
  vendor_return_esign_url TEXT,
  dispatched_at TIMESTAMPTZ,
  returned_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vrdc_status ON vendor_repair_delivery_challans(status);
CREATE INDEX IF NOT EXISTS idx_tickets_diagnosis_failed ON tickets(status) WHERE status = 'diagnosis_failed';

CREATE TABLE IF NOT EXISTS vendor_repair_dc_items (
  id SERIAL PRIMARY KEY,
  dc_number VARCHAR(64) NOT NULL REFERENCES vendor_repair_delivery_challans(dc_number) ON DELETE CASCADE,
  ticket_id INTEGER NOT NULL REFERENCES tickets(ticket_id) ON DELETE CASCADE,
  serial_id INTEGER REFERENCES vendor_serial_numbers(serial_id) ON DELETE SET NULL,
  ttspl_id VARCHAR(64),
  serial_number VARCHAR(128),
  configuration TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (dc_number, ticket_id)
);

CREATE INDEX IF NOT EXISTS idx_vrdc_items_ticket ON vendor_repair_dc_items(ticket_id);
