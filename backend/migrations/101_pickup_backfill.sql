-- Phase 21: backfill legacy / partially-created pickup items so they all run the
-- unified Phase 20 pickup flow (Assigned -> Reached -> POD -> Customer OTP ->
-- Warehouse e-sign). Earlier pickups were created without pickup_type /
-- pickup_method / customer_otp_code / return_dc_number, which left the technician
-- with no actionable UI.

-- 1) Every pickup item gets a pickup_type. Default to 'return' (the common case
--    for a Return DC); explicit repair pickups already carry their value.
UPDATE support_ticket_items
   SET pickup_type = 'return', updated_at = NOW()
 WHERE item_type = 'pickup'
   AND pickup_type IS NULL;

-- 2) Default dispatch method to in-house (technician) when not set and not a
--    courier/porter dispatch.
UPDATE support_ticket_items
   SET pickup_method = 'inhouse', updated_at = NOW()
 WHERE item_type = 'pickup'
   AND (pickup_method IS NULL OR pickup_method = '')
   AND loan_delivered_at IS NULL;

-- 3) Mirror assigned_to into pickup_assigned_to so per-technician guards work.
UPDATE support_ticket_items
   SET pickup_assigned_to = assigned_to, updated_at = NOW()
 WHERE item_type = 'pickup'
   AND pickup_assigned_to IS NULL
   AND assigned_to IS NOT NULL;

-- 4) Mint a customer OTP for in-house pickups still awaiting handover, so the
--    technician's "Enter customer OTP" step has something to verify against.
UPDATE support_ticket_items
   SET customer_otp_code = LPAD((floor(random() * 1000000))::int::text, 6, '0'),
       customer_otp_sent_at = COALESCE(customer_otp_sent_at, NOW()),
       updated_at = NOW()
 WHERE item_type = 'pickup'
   AND customer_otp_code IS NULL
   AND customer_otp_verified_at IS NULL
   AND warehouse_received_at IS NULL
   AND pickup_method NOT IN ('courier', 'porter');

-- 5) Link the pickup item to its Return DC when missing (one return DC per ticket
--    in current data).
UPDATE support_ticket_items sti
   SET return_dc_number = dcl.dc_number, updated_at = NOW()
  FROM delivery_challan_lines dcl
 WHERE sti.item_type = 'pickup'
   AND sti.return_dc_number IS NULL
   AND dcl.movement_type = 'return'
   AND dcl.support_ticket_id = sti.ticket_id;
