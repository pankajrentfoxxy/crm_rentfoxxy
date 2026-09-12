-- Vendor rental return tickets + the vendor-bill stop column.
-- See vendor rental return ticket-first spec.

-- ---------------------------------------------------------------- FIX 0
ALTER TABLE vendor_serial_numbers
  ADD COLUMN IF NOT EXISTS vendor_rent_end_date        DATE,
  ADD COLUMN IF NOT EXISTS vendor_return_ticket_number VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_vsn_vendor_rent_end
  ON vendor_serial_numbers (vendor_rent_end_date) WHERE vendor_rent_end_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vsn_vendor_return_ticket
  ON vendor_serial_numbers (vendor_return_ticket_number) WHERE vendor_return_ticket_number IS NOT NULL;

UPDATE vendor_serial_numbers vsn
   SET vendor_rent_end_date = d.dispatched_at::date
  FROM vendor_return_dc_items i
  JOIN vendor_return_delivery_challans d ON d.dc_number = i.dc_number
 WHERE i.serial_id = vsn.serial_id
   AND d.status IN ('dispatched','completed')
   AND d.dispatched_at IS NOT NULL
   AND vsn.vendor_rent_end_date IS NULL;

UPDATE vendor_serial_numbers
   SET vendor_rent_end_date = COALESCE(status_changed_at::date, updated_at::date, CURRENT_DATE)
 WHERE vendor_rent_end_date IS NULL
   AND (inventory_status = 'scrapped' OR qc_status = 'returned_to_vendor');

ALTER TABLE vendor_bill_lines
  ADD COLUMN IF NOT EXISTS rent_start  DATE,
  ADD COLUMN IF NOT EXISTS rent_end    DATE,
  ADD COLUMN IF NOT EXISTS is_returned BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------- TICKET
CREATE TABLE IF NOT EXISTS vendor_return_tickets (
  id                  SERIAL PRIMARY KEY,
  ticket_number       VARCHAR(64) UNIQUE NOT NULL,
  vendor_id           INT NOT NULL REFERENCES vendors(vendor_id),
  vendor_name         VARCHAR(255),
  vendor_email        VARCHAR(255),
  return_reason       TEXT,
  remarks             TEXT,
  status              VARCHAR(32) NOT NULL DEFAULT 'requested'
                      CHECK (status IN ('requested','notified','partially_picked','picked','completed','cancelled')),
  request_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  vendor_notified_at  TIMESTAMPTZ,
  vendor_notified_by  INT REFERENCES users(user_id),
  notify_error        TEXT,
  completed_at        TIMESTAMPTZ,
  created_by          INT REFERENCES users(user_id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vrt_vendor ON vendor_return_tickets(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vrt_status ON vendor_return_tickets(status);

CREATE TABLE IF NOT EXISTS vendor_return_ticket_items (
  id                 SERIAL PRIMARY KEY,
  ticket_number      VARCHAR(64) NOT NULL
                     REFERENCES vendor_return_tickets(ticket_number) ON DELETE CASCADE,
  serial_id          INT NOT NULL REFERENCES vendor_serial_numbers(serial_id) ON DELETE RESTRICT,
  po_id              INT REFERENCES vendor_purchase_orders(po_id),
  ttspl_id           VARCHAR(64),
  serial_number      VARCHAR(128),
  brand              VARCHAR(100),
  model              VARCHAR(255),
  configuration      TEXT,
  monthly_rent_rate  NUMERIC(12,2),
  item_status        VARCHAR(32) NOT NULL DEFAULT 'requested'
                     CHECK (item_status IN ('requested','rental_stopped','dc_created','handed_over','vendor_received','cancelled')),
  rental_stopped_at  TIMESTAMPTZ,
  dc_number          VARCHAR(64),
  handed_over_at     TIMESTAMPTZ,
  handed_over_by     INT REFERENCES users(user_id),
  vendor_received_at TIMESTAMPTZ,
  remarks            TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticket_number, serial_id)
);
CREATE INDEX IF NOT EXISTS idx_vrti_serial ON vendor_return_ticket_items(serial_id);
CREATE INDEX IF NOT EXISTS idx_vrti_status ON vendor_return_ticket_items(item_status);
CREATE INDEX IF NOT EXISTS idx_vrti_dc     ON vendor_return_ticket_items(dc_number);

CREATE UNIQUE INDEX IF NOT EXISTS uq_vrti_open_serial
  ON vendor_return_ticket_items (serial_id)
  WHERE item_status NOT IN ('cancelled','vendor_received');

ALTER TABLE vendor_return_delivery_challans
  ADD COLUMN IF NOT EXISTS return_ticket_number VARCHAR(64)
    REFERENCES vendor_return_tickets(ticket_number);
CREATE INDEX IF NOT EXISTS idx_vrtdc_ticket
  ON vendor_return_delivery_challans (return_ticket_number) WHERE return_ticket_number IS NOT NULL;

INSERT INTO sm_document_sequences (doc_type, last_value, prefix)
VALUES ('vendor_return_ticket', 0, 'VRT')
ON CONFLICT (doc_type) DO NOTHING;

INSERT INTO permission_sections (section, description, sort_order)
VALUES ('vendor_return_ticket', 'Vendor Return Ticket', 176)
ON CONFLICT (section) DO NOTHING;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES ('admin','vendor_return_ticket',TRUE,TRUE,TRUE,TRUE),
       ('super_admin','vendor_return_ticket',TRUE,TRUE,TRUE,TRUE),
       ('manager','vendor_return_ticket',TRUE,TRUE,TRUE,FALSE),
       ('warehouse','vendor_return_ticket',TRUE,TRUE,TRUE,FALSE),
       ('procurement','vendor_return_ticket',TRUE,TRUE,TRUE,FALSE),
       ('floor_manager','vendor_return_ticket',TRUE,TRUE,TRUE,FALSE)
ON CONFLICT (role, section) DO NOTHING;
