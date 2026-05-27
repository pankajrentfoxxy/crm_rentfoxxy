-- Allow GRNs and serial rows to attach to spare parts PO (CRM parity with Laravel spare receive).

ALTER TABLE vendor_goods_received_notes ALTER COLUMN po_id DROP NOT NULL;
ALTER TABLE vendor_goods_received_notes ADD COLUMN IF NOT EXISTS spo_id INT REFERENCES vendor_spare_parts_purchase_orders(spo_id) ON DELETE CASCADE;

ALTER TABLE vendor_goods_received_notes DROP CONSTRAINT IF EXISTS vendor_grn_po_or_spo_chk;
ALTER TABLE vendor_goods_received_notes ADD CONSTRAINT vendor_grn_po_or_spo_chk CHECK (
  (po_id IS NOT NULL AND spo_id IS NULL) OR (po_id IS NULL AND spo_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_vgrn_spo ON vendor_goods_received_notes (spo_id) WHERE spo_id IS NOT NULL;

ALTER TABLE vendor_serial_numbers ALTER COLUMN po_id DROP NOT NULL;
ALTER TABLE vendor_serial_numbers ADD COLUMN IF NOT EXISTS spo_id INT REFERENCES vendor_spare_parts_purchase_orders(spo_id) ON DELETE CASCADE;

ALTER TABLE vendor_serial_numbers DROP CONSTRAINT IF EXISTS vendor_serial_po_or_spo_chk;
ALTER TABLE vendor_serial_numbers ADD CONSTRAINT vendor_serial_po_or_spo_chk CHECK (
  (po_id IS NOT NULL AND spo_id IS NULL) OR (po_id IS NULL AND spo_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_vendor_serial_spo_grn ON vendor_serial_numbers (spo_id, grn_id) WHERE spo_id IS NOT NULL;
