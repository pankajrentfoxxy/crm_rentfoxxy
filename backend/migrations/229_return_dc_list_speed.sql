-- 229: indexes for Return DC list filters and warehouse-pending EXISTS.

CREATE INDEX IF NOT EXISTS idx_dcl_return_status_created
  ON delivery_challan_lines (status, created_at DESC)
  WHERE movement_type = 'return';

CREATE INDEX IF NOT EXISTS idx_dcl_return_dc_number
  ON delivery_challan_lines (dc_number)
  WHERE movement_type = 'return';

CREATE INDEX IF NOT EXISTS idx_sti_pickup_rdc_pending_receive
  ON support_ticket_items (return_dc_number)
  WHERE item_type = 'pickup'
    AND return_dc_number IS NOT NULL
    AND warehouse_received_at IS NULL;
