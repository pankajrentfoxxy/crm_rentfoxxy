-- Dispatch charger: warehouse asset sent with a laptop to the customer.
-- Separate from floor part_requests / technician part attach.

INSERT INTO permission_sections (section, description, sort_order)
VALUES
  (
    'dispatch_charger',
    'Dispatch QC — attach charger to laptop going to customer',
    168
  ),
  (
    'dispatch_charger_warehouse',
    'Warehouse — approve and hand over dispatch chargers',
    169
  )
ON CONFLICT (section) DO UPDATE
  SET description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin', 'dispatch_charger', true, true, true, false),
  ('super_admin', 'dispatch_charger', true, true, true, false),
  ('dispatch_qc', 'dispatch_charger', true, true, true, false),
  ('dispatch', 'dispatch_charger', true, true, true, false),
  ('manager', 'dispatch_charger', true, true, true, false),
  ('floor_manager', 'dispatch_charger', true, true, true, false),
  ('warehouse', 'dispatch_charger', true, false, false, false),
  ('support_lead', 'dispatch_charger', true, false, true, false),
  ('support_tech', 'dispatch_charger', true, false, true, false),
  ('admin', 'dispatch_charger_warehouse', true, false, true, false),
  ('super_admin', 'dispatch_charger_warehouse', true, false, true, false),
  ('warehouse', 'dispatch_charger_warehouse', true, false, true, false),
  ('manager', 'dispatch_charger_warehouse', true, false, true, false),
  ('floor_manager', 'dispatch_charger_warehouse', true, false, true, false)
ON CONFLICT (role, section) DO UPDATE
  SET can_view = EXCLUDED.can_view,
      can_create = EXCLUDED.can_create,
      can_edit = EXCLUDED.can_edit;

INSERT INTO sm_document_sequences (doc_type, last_value, prefix)
VALUES ('dcr', 0, 'DCR-')
ON CONFLICT (doc_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS dispatch_charger_requests (
  request_id SERIAL PRIMARY KEY,
  request_number VARCHAR(40) UNIQUE NOT NULL,
  ticket_id INTEGER REFERENCES tickets(ticket_id),
  allocation_id INTEGER,
  serial_id INTEGER,
  ttspl_id VARCHAR(64),
  sales_order_number VARCHAR(80),
  disposition VARCHAR(40) NOT NULL
    CHECK (disposition IN ('attach', 'already_with_customer')),
  status VARCHAR(40) NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'handed_over',
      'attached',
      'already_with_customer',
      'dispatched',
      'returned',
      'cancelled'
    )),
  part_id INTEGER,
  part_instance_id INTEGER,
  prt_id VARCHAR(80),
  charger_asset_code VARCHAR(80),
  charger_serial VARCHAR(128),
  charger_part_name VARCHAR(200),
  requested_by INTEGER,
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  handed_over_by INTEGER,
  handed_over_at TIMESTAMPTZ,
  attached_by INTEGER,
  attached_at TIMESTAMPTZ,
  qc_ttspl_scanned VARCHAR(80),
  qc_charger_scanned VARCHAR(128),
  qc_scan_matched BOOLEAN,
  qc_scanned_by INTEGER,
  qc_scanned_at TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ,
  returned_at TIMESTAMPTZ,
  remarks TEXT,
  cancelled_at TIMESTAMPTZ,
  cancelled_by INTEGER,
  extra JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_dcr_ticket_active
  ON dispatch_charger_requests (ticket_id)
  WHERE ticket_id IS NOT NULL AND status NOT IN ('cancelled', 'returned');

CREATE UNIQUE INDEX IF NOT EXISTS uq_dcr_instance_active
  ON dispatch_charger_requests (part_instance_id)
  WHERE part_instance_id IS NOT NULL
    AND status IN ('handed_over', 'attached', 'dispatched');

CREATE INDEX IF NOT EXISTS idx_dcr_status ON dispatch_charger_requests (status);
CREATE INDEX IF NOT EXISTS idx_dcr_ttspl ON dispatch_charger_requests (ttspl_id);
CREATE INDEX IF NOT EXISTS idx_dcr_so ON dispatch_charger_requests (sales_order_number);

CREATE TABLE IF NOT EXISTS dispatch_charger_return_scans (
  scan_id SERIAL PRIMARY KEY,
  request_id INTEGER REFERENCES dispatch_charger_requests(request_id),
  pickup_item_id INTEGER,
  return_dc_number VARCHAR(80),
  ttspl_scanned VARCHAR(80),
  charger_scanned VARCHAR(128),
  matched BOOLEAN NOT NULL DEFAULT false,
  scanned_by INTEGER,
  scanned_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_dcrs_pickup ON dispatch_charger_return_scans (pickup_item_id);
CREATE INDEX IF NOT EXISTS idx_dcrs_rdc ON dispatch_charger_return_scans (return_dc_number);

ALTER TABLE part_instances DROP CONSTRAINT IF EXISTS part_instances_status_check;
ALTER TABLE part_instances ADD CONSTRAINT part_instances_status_check
  CHECK (status IN (
    'in_stock', 'reserved', 'installed', 'defective', 'returned', 'discarded', 'sold',
    'with_technician', 'in_transit', 'with_vendor_repair', 'qc_pending',
    'scrapped', 'with_customer'
  ));
