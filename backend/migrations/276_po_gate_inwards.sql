-- 276: Guard gate inward against a vendor Purchase Order.
--
-- The guard counts the laptops that physically arrived against a PO (e.g. 2 of 10)
-- and records them here. Warehouse then takes a GRN for exactly that inward: each
-- inward gets its own GRN (vendor_goods_received_notes), so a PO can be received
-- over several GRNs. Received quantity per inward is derived from
-- vendor_serial_numbers (grn_id + extra.line_index); nothing is stored twice.

CREATE TABLE IF NOT EXISTS po_gate_inwards (
  inward_id         SERIAL PRIMARY KEY,
  inward_number     VARCHAR(32) UNIQUE,
  po_id             INTEGER NOT NULL REFERENCES vendor_purchase_orders(po_id),
  grn_id            INTEGER REFERENCES vendor_goods_received_notes(grn_id),
  total_qty         INTEGER NOT NULL CHECK (total_qty > 0),
  vendor_doc_number VARCHAR(120),
  vehicle_number    VARCHAR(40),
  remarks           TEXT,
  -- pending_grn | partially_received | received | closed
  status            VARCHAR(24) NOT NULL DEFAULT 'pending_grn',
  guard_user_id     INTEGER,
  guard_name        VARCHAR(160),
  closed_at         TIMESTAMPTZ,
  closed_by         INTEGER,
  close_reason      TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_po_gate_inwards_po ON po_gate_inwards (po_id);
CREATE INDEX IF NOT EXISTS idx_po_gate_inwards_status ON po_gate_inwards (status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_po_gate_inwards_grn
  ON po_gate_inwards (grn_id) WHERE grn_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS po_gate_inward_lines (
  id          SERIAL PRIMARY KEY,
  inward_id   INTEGER NOT NULL REFERENCES po_gate_inwards(inward_id) ON DELETE CASCADE,
  line_index  INTEGER NOT NULL CHECK (line_index >= 0),
  qty         INTEGER NOT NULL CHECK (qty > 0),
  line_label  TEXT,
  UNIQUE (inward_id, line_index)
);
