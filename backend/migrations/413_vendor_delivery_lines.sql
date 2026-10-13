-- 413: one gate-inward record. Production's PO Inward (276, po_gate_inwards)
-- and staging's Vendor arrivals (334, vendor_deliveries) both logged the same
-- truck at the gate. vendor_deliveries is kept; this adds what 276 had that it
-- lacked — the guard's count per PO line — and copies any po_gate_inwards rows
-- across so their GRNs stay tied to a gate entry.
--
-- A delivery with no lines (logged before this migration) keeps its single
-- laptop_count cap across all PO lines.

CREATE TABLE IF NOT EXISTS vendor_delivery_lines (
  id          SERIAL PRIMARY KEY,
  delivery_id INT NOT NULL REFERENCES vendor_deliveries(delivery_id) ON DELETE CASCADE,
  line_index  INT NOT NULL CHECK (line_index >= 0),
  qty         INT NOT NULL CHECK (qty > 0),
  line_label  TEXT,
  UNIQUE (delivery_id, line_index)
);
CREATE INDEX IF NOT EXISTS idx_vendor_delivery_lines_delivery ON vendor_delivery_lines (delivery_id);

-- Which po_gate_inwards row a copied delivery came from (also makes the copy re-runnable).
ALTER TABLE vendor_deliveries ADD COLUMN IF NOT EXISTS legacy_gate_inward_id INT UNIQUE;

DO $$
BEGIN
  IF to_regclass('public.po_gate_inwards') IS NULL THEN
    RETURN;
  END IF;

  -- pending_grn -> arrived, partially_received -> receiving, received -> received,
  -- closed -> received (something came in) or cancelled (nothing did).
  INSERT INTO vendor_deliveries (
    delivery_number, po_id, vendor_id, vendor_challan_no, laptop_count, vehicle_no, notes,
    status, grn_id, arrived_at, logged_by, completed_at, completed_by, completion_note,
    created_at, updated_at, legacy_gate_inward_id
  )
  SELECT gi.inward_number, gi.po_id, p.vendor_id, gi.vendor_doc_number, gi.total_qty, gi.vehicle_number, gi.remarks,
         CASE gi.status
           WHEN 'pending_grn' THEN 'arrived'
           WHEN 'partially_received' THEN 'receiving'
           WHEN 'received' THEN 'received'
           ELSE CASE WHEN gi.grn_id IS NULL THEN 'cancelled' ELSE 'received' END
         END,
         gi.grn_id, gi.created_at, u.user_id, gi.closed_at, cu.user_id, gi.close_reason,
         gi.created_at, gi.updated_at, gi.inward_id
    FROM po_gate_inwards gi
    JOIN vendor_purchase_orders p ON p.po_id = gi.po_id
    LEFT JOIN users u ON u.user_id = gi.guard_user_id
    LEFT JOIN users cu ON cu.user_id = gi.closed_by
   WHERE NOT EXISTS (SELECT 1 FROM vendor_deliveries d WHERE d.legacy_gate_inward_id = gi.inward_id)
     AND NOT EXISTS (SELECT 1 FROM vendor_deliveries d WHERE d.delivery_number = gi.inward_number);

  INSERT INTO vendor_delivery_lines (delivery_id, line_index, qty, line_label)
  SELECT d.delivery_id, l.line_index, l.qty, l.line_label
    FROM po_gate_inward_lines l
    JOIN vendor_deliveries d ON d.legacy_gate_inward_id = l.inward_id
  ON CONFLICT (delivery_id, line_index) DO NOTHING;

  UPDATE vendor_goods_received_notes g
     SET delivery_id = d.delivery_id
    FROM vendor_deliveries d
   WHERE d.legacy_gate_inward_id IS NOT NULL AND g.grn_id = d.grn_id AND g.delivery_id IS NULL;
END $$;
