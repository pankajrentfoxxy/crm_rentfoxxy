-- 432: Visit → repair / return pickup (16 Oct 2026).
--   repair_pickup_requested — the technician asks to take the laptop to the
--                             workshop; the Support Lead approves or rejects
--   return_required         — the lead converted the visit to a return pickup
--                             (repair_required already means "to a repair pickup")
-- Widens the outcome CHECK from migration 344. Additive only.

ALTER TABLE support_ticket_items DROP CONSTRAINT IF EXISTS support_ticket_items_outcome_check;
ALTER TABLE support_ticket_items ADD CONSTRAINT support_ticket_items_outcome_check
  CHECK (outcome IS NULL OR outcome IN ('fixed', 'working', 'replacement_required', 'repair_required',
                                         'repair_pickup_requested', 'return_required'));
