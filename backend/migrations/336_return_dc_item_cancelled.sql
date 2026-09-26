-- B14: cancelling a return challan left its laptops' item rows at 'draft'
-- (the CHECK had no 'cancelled'), so totals and "already on a return" checks
-- kept counting them. Items of already-cancelled challans are corrected.
ALTER TABLE vendor_return_dc_items DROP CONSTRAINT IF EXISTS vendor_return_dc_items_item_status_check;
ALTER TABLE vendor_return_dc_items ADD CONSTRAINT vendor_return_dc_items_item_status_check
  CHECK (item_status IN ('draft', 'dispatched', 'vendor_received', 'cancelled'));
UPDATE vendor_return_dc_items i SET item_status = 'cancelled'
  FROM vendor_return_delivery_challans d
 WHERE d.dc_number = i.dc_number AND d.status = 'cancelled' AND i.item_status = 'draft';
