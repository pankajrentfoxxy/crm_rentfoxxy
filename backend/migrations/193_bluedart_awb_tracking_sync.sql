-- BlueDart TNT tracking sync fields on delivery challan lines
ALTER TABLE delivery_challan_lines
  ADD COLUMN IF NOT EXISTS courier_tracking_status TEXT,
  ADD COLUMN IF NOT EXISTS courier_tracking_status_type TEXT,
  ADD COLUMN IF NOT EXISTS courier_tracking_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS courier_received_by TEXT;

CREATE INDEX IF NOT EXISTS idx_dcl_awb_undelivered
  ON delivery_challan_lines (awb_number)
  WHERE awb_number IS NOT NULL
    AND TRIM(awb_number) <> ''
    AND status IS DISTINCT FROM 'delivered'
    AND status IS DISTINCT FROM 'cancelled'
    AND status IS DISTINCT FROM 'rejected';

COMMENT ON COLUMN delivery_challan_lines.courier_tracking_status IS
  'Latest BlueDart TNT Status text';
COMMENT ON COLUMN delivery_challan_lines.courier_tracking_status_type IS
  'Latest BlueDart TNT StatusType (e.g. DL, IT, UD)';
COMMENT ON COLUMN delivery_challan_lines.courier_received_by IS
  'BlueDart ReceivedBy when delivered';
