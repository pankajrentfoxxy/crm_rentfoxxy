-- Ready-to-rent / inventory list performance (passed segment, tickets, PO filters)

CREATE INDEX IF NOT EXISTS idx_vsn_qc_status_updated
  ON vendor_serial_numbers (qc_status, updated_at DESC)
  WHERE deleted_at IS NULL AND po_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vsn_inventory_status_po
  ON vendor_serial_numbers (inventory_status, updated_at DESC)
  WHERE deleted_at IS NULL AND po_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_vpo_purchase_order_type
  ON vendor_purchase_orders (purchase_order_type)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_vendor_serial_created
  ON tickets (vendor_serial_id, created_at DESC)
  WHERE vendor_serial_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_vendor_serial_active
  ON tickets (vendor_serial_id, created_at DESC)
  WHERE vendor_serial_id IS NOT NULL
    AND status IN ('in_progress', 'on_hold');

CREATE INDEX IF NOT EXISTS idx_inventory_machine_number
  ON inventory (machine_number)
  WHERE machine_number IS NOT NULL AND TRIM(machine_number) <> '';

CREATE INDEX IF NOT EXISTS idx_vpd_old_product_id
  ON vendor_product_details (old_product_id)
  WHERE old_product_id IS NOT NULL;
