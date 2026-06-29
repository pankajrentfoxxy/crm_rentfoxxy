-- Migration 116: Allow by_porter in delivery_challan_lines.ship_by
-- Porter dispatch was added in migration 086 (dispatch_mode + porter_* columns)
-- but ship_by CHECK was never extended beyond by_hand / by_courier.

ALTER TABLE delivery_challan_lines
  DROP CONSTRAINT IF EXISTS delivery_challan_lines_ship_by_check;

ALTER TABLE delivery_challan_lines
  ADD CONSTRAINT delivery_challan_lines_ship_by_check
  CHECK (
    ship_by IS NULL
    OR ship_by IN ('by_hand', 'by_courier', 'by_porter')
  );
