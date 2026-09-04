-- Return Laptop to Vendor (warehouse → original supplier, one-way)
BEGIN;

CREATE TABLE IF NOT EXISTS vendor_return_delivery_challans (
  id                  SERIAL PRIMARY KEY,
  dc_number           VARCHAR(64) UNIQUE NOT NULL,
  vendor_id           INTEGER REFERENCES vendors(vendor_id) ON DELETE SET NULL,
  po_id               INTEGER REFERENCES vendor_purchase_orders(po_id) ON DELETE SET NULL,
  vendor_name         VARCHAR(255),
  vendor_address      TEXT,
  billing_address     TEXT,
  shipping_address    TEXT,
  contact_person      VARCHAR(255),
  contact_mobile      VARCHAR(50),
  return_reason       TEXT,
  remarks             TEXT,
  warehouse_name      VARCHAR(255),
  warehouse_address   TEXT,
  status              VARCHAR(32) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'dispatched', 'completed', 'cancelled')),
  return_date         DATE DEFAULT CURRENT_DATE,
  dispatched_at       TIMESTAMPTZ,
  vendor_received_at  TIMESTAMPTZ,
  vendor_received_by  INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  ship_by             VARCHAR(20),
  dispatch_mode       VARCHAR(20),
  courier_name        VARCHAR(255),
  awb_number          VARCHAR(100),
  courier_tracking_url TEXT,
  porter_tracking_id  VARCHAR(100),
  delivery_person_id  INTEGER,
  created_by          INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vrtdc_vendor ON vendor_return_delivery_challans(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vrtdc_po ON vendor_return_delivery_challans(po_id);
CREATE INDEX IF NOT EXISTS idx_vrtdc_status ON vendor_return_delivery_challans(status);

CREATE TABLE IF NOT EXISTS vendor_return_dc_items (
  id                    SERIAL PRIMARY KEY,
  dc_number             VARCHAR(64) NOT NULL REFERENCES vendor_return_delivery_challans(dc_number) ON DELETE CASCADE,
  serial_id             INTEGER NOT NULL REFERENCES vendor_serial_numbers(serial_id) ON DELETE RESTRICT,
  po_id                 INTEGER REFERENCES vendor_purchase_orders(po_id) ON DELETE SET NULL,
  grn_id                INTEGER REFERENCES vendor_goods_received_notes(grn_id) ON DELETE SET NULL,
  original_vendor_id    INTEGER REFERENCES vendors(vendor_id) ON DELETE SET NULL,
  ttspl_id              VARCHAR(64),
  serial_number         VARCHAR(128),
  brand                 VARCHAR(100),
  model                 VARCHAR(255),
  configuration         TEXT,
  warehouse_carret      VARCHAR(64),
  warehouse_carret_slot VARCHAR(64),
  return_reason         TEXT,
  item_status           VARCHAR(32) NOT NULL DEFAULT 'draft'
    CHECK (item_status IN ('draft', 'dispatched', 'vendor_received')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (dc_number, serial_id)
);

CREATE INDEX IF NOT EXISTS idx_vrtdc_items_serial ON vendor_return_dc_items(serial_id);
CREATE INDEX IF NOT EXISTS idx_vrtdc_items_po ON vendor_return_dc_items(po_id);

ALTER TABLE vendor_serial_numbers
  ADD COLUMN IF NOT EXISTS vendor_return_dc_number VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_vsn_vendor_return_dc
  ON vendor_serial_numbers(vendor_return_dc_number)
  WHERE vendor_return_dc_number IS NOT NULL;

INSERT INTO permission_sections (section, description, sort_order)
VALUES ('vendor_return_to_vendor', 'Return laptops to vendor (warehouse)', 48)
ON CONFLICT (section) DO UPDATE SET description = EXCLUDED.description, sort_order = EXCLUDED.sort_order;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES
  ('admin', 'vendor_return_to_vendor', true, true, true, true),
  ('manager', 'vendor_return_to_vendor', true, true, true, false),
  ('warehouse', 'vendor_return_to_vendor', true, true, true, false),
  ('procurement', 'vendor_return_to_vendor', true, true, true, false)
ON CONFLICT (role, section) DO UPDATE SET
  can_view = EXCLUDED.can_view,
  can_create = EXCLUDED.can_create,
  can_edit = EXCLUDED.can_edit,
  can_delete = EXCLUDED.can_delete;

COMMIT;
