-- Speed up Return DC list (/sales-pipeline/return-dc)

CREATE INDEX IF NOT EXISTS idx_sti_return_dc_pickup
  ON support_ticket_items (return_dc_number)
  WHERE item_type = 'pickup' AND return_dc_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sti_pickup_ticket_fallback
  ON support_ticket_items (ticket_id)
  WHERE item_type = 'pickup' AND return_dc_number IS NULL;

CREATE INDEX IF NOT EXISTS idx_dcl_return_created
  ON delivery_challan_lines (created_at DESC)
  WHERE movement_type = 'return';
