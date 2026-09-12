-- VRTDC warehouse send-to-gate, then guard outward confirm.
ALTER TABLE vendor_return_delivery_challans
  DROP CONSTRAINT IF EXISTS vendor_return_delivery_challans_status_check;

ALTER TABLE vendor_return_delivery_challans
  ADD CONSTRAINT vendor_return_delivery_challans_status_check
  CHECK (status IN ('draft', 'dispatch_ready', 'dispatched', 'completed', 'cancelled'));
