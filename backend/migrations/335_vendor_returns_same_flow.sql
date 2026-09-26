-- Procure to stock, step 6 (vendor returns and repair).
--
-- D9: 'returned_to_vendor' is a real inventory status (added to the state
--     machine). The 13 laptops already sent back were recorded as 'scrapped';
--     they are moved to the new status here, with a transitions row each so
--     the correction is visible in the laptop's history.
-- D12: debit notes record what raised them (floor QC fail, return challan,
--     replacement), so one is drafted per return and never twice.
-- B13: a return challan keeps the Porter order id and booking link it is
--     dispatched with (they were accepted and then dropped).
-- B23: a repair challan can be cancelled before it leaves, with a reason.

-- The canonical-status CHECK (migration 259) gains the thirteenth value.
ALTER TABLE public.vendor_serial_numbers
  DROP CONSTRAINT IF EXISTS vendor_serial_numbers_inventory_status_check;
ALTER TABLE public.vendor_serial_numbers
  ADD CONSTRAINT vendor_serial_numbers_inventory_status_check
  CHECK (
    deleted_at IS NOT NULL
    OR inventory_status IS NULL
    OR inventory_status IN (
      'in_stock', 'reserved', 'dispatch_ready', 'at_gate', 'in_transit', 'rented', 'on_demo',
      'sold', 'returned', 'in_repair', 'qc_failed', 'scrapped', 'returned_to_vendor'
    )
  );

INSERT INTO inventory_status_transitions (serial_id, ttspl_id, from_status, to_status, reason, dc_number)
SELECT serial_id, inventory_asset_code, 'scrapped', 'returned_to_vendor',
       'D9 correction: returned to vendor, was recorded as scrapped', vendor_return_dc_number
  FROM vendor_serial_numbers
 WHERE inventory_status = 'scrapped' AND qc_status = 'returned_to_vendor' AND deleted_at IS NULL;

UPDATE vendor_serial_numbers SET inventory_status = 'returned_to_vendor', updated_at = NOW()
 WHERE inventory_status = 'scrapped' AND qc_status = 'returned_to_vendor' AND deleted_at IS NULL;

ALTER TABLE vendor_debit_notes
  ADD COLUMN IF NOT EXISTS source VARCHAR(40),
  ADD COLUMN IF NOT EXISTS source_ref VARCHAR(100);
UPDATE vendor_debit_notes SET source = 'floor_qc_fail' WHERE source IS NULL AND return_ticket_id IS NOT NULL;

ALTER TABLE vendor_return_delivery_challans
  ADD COLUMN IF NOT EXISTS porter_order_id VARCHAR(100),
  ADD COLUMN IF NOT EXISTS porter_booking_url TEXT;

ALTER TABLE vendor_repair_delivery_challans
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by INT REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
