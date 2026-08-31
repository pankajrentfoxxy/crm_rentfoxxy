-- 209: allow dispatch_ready on delivery_challan_lines.status
-- DC create now writes this status; Guard submit later sets in_transit.

ALTER TABLE delivery_challan_lines
  DROP CONSTRAINT IF EXISTS delivery_challan_lines_status_check;

ALTER TABLE delivery_challan_lines
  ADD CONSTRAINT delivery_challan_lines_status_check
  CHECK (status IN (
    'pending',
    'processing',
    'dispatch_ready',
    'shipped',
    'in_transit',
    'reached',
    'delivered',
    'rejected',
    'cancelled'
  ));
