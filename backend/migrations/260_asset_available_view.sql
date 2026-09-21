-- Part 2.5 (finding I10) — ONE definition of "available".
--
-- Six mutually inconsistent predicates existed, and they disagreed in ways
-- users felt:
--
--   salesManagementService.js:2359   blacklist of 12 statuses. Did NOT exclude
--                                    in_repair, so a unit on the bench could be
--                                    attached to a sales order.
--   inventoryManagementService.js:77 blacklist of 9 — omitted qc_failed,
--                                    out_for_repare and out_for_return, so
--                                    Ready-to-Rent offered units that SO attach
--                                    would then refuse. That is finding I18,
--                                    and the comment above it claimed the two
--                                    lists were aligned.
--   supportInventoryService.js:68    whitelist: in_stock + QC passed + no
--                                    customer. The strictest of the six.
--   dispatchWorkflowService.js:331   accepted inventory_status='passed', which
--                                    is a qc_status value, and COALESCEd NULL
--                                    to in_stock.
--   salesOrderSerialController.js:193 per-row check with its own rules.
--   analyticsController.js:186       counted qc_status='qc_passed' and
--                                    inventory_status='out_stock' — values NO
--                                    current code writes (finding I11), so the
--                                    dashboard counted only ERP-imported rows.
--
-- A view rather than a function: every one of the six call sites needs to JOIN
-- this against other filters (entity, brand, location, search), and a set-
-- returning function would force each of them to materialise first.
--
-- NULL IS EXCLUDED, and this is the line that implements decision D1.
--
-- Today every availability query does COALESCE(inventory_status,'in_stock'),
-- which silently means "if we do not know, assume it is on the shelf". After
-- the census that is not a harmless default: 1,372 rows are NULL and 1,345 of
-- them are real laptops that have never been through GRN — no ticket, no PO,
-- no brand, no model, zero events. They are uninspected stock with no recorded
-- configuration, and the COALESCE made all of them attachable and sellable.
-- Requiring inventory_status = 'in_stock' is what takes them off the shelf.

CREATE OR REPLACE VIEW public.asset_available AS
SELECT
  vsn.serial_id,
  COALESCE(vsn.inventory_asset_code, vsn.extra->>'ttspl_id') AS ttspl_id,
  vsn.serial_number,
  vsn.inventory_status,
  vsn.qc_status,
  vsn.current_entity,
  vsn.po_id,
  vsn.rent_monthly_rate,
  vsn.extra
FROM public.vendor_serial_numbers vsn
WHERE vsn.deleted_at IS NULL

  -- Canonical and on the shelf. NULL is NOT in stock (decision D1).
  AND vsn.inventory_status = 'in_stock'

  -- qc_status is deliberately NOT tested here (decision D5).
  --
  -- inventory_status='in_stock' is DEFINED as "on the shelf, QC-passed,
  -- attachable" (Part 1 §6.2), and Part 2.3 has just made it canonical and
  -- constrained. qc_status is the column decision D2 declared unreliable until
  -- Part 5 rewrites its writer — gating the whole fleet's availability on a
  -- column formally known to be untrustworthy is backwards.
  --
  -- The numbers that forced the decision: of 1,930 canonically in-stock units,
  -- only 48 carry qc_status='passed'. 852 say 'pending', 758 'in_used' and 271
  -- 'qc_pending', all ERP-import artefacts from Feb–Jun. Requiring 'passed'
  -- would have said the business owns 48 rentable laptops.

  -- Still held by a customer, whatever the status column says. A unit cannot be
  -- both on the shelf and with someone.
  AND vsn.current_customer_id IS NULL

  -- Received into the warehouse but not yet serial-verified. The old
  -- Ready-to-Rent list carried this filter and SO attach did not, which is one
  -- of the six ways the lists disagreed.
  AND COALESCE(vsn.extra->>'awaiting_inventory_receive', 'false') <> 'true'

  -- Already promised. An allocation that has been dispatched still blocks the
  -- unit: finding S4 is that uq_sos_serial_active only covers status='attached',
  -- so once an allocation flips to dispatched the same serial could be attached
  -- to a second order. The index is widened in Part 4; this view does not wait
  -- for it, because offering a dispatched unit is the visible half of that bug.
  AND NOT EXISTS (
    SELECT 1
      FROM public.sales_order_serials sos
     WHERE sos.serial_id = vsn.serial_id
       AND sos.status IN ('attached', 'dispatched')
  )

  -- On the floor. A unit with an open production ticket is being worked on, and
  -- three of the six predicates checked this while three did not.
  AND NOT EXISTS (
    SELECT 1
      FROM public.tickets t
     WHERE t.vendor_serial_id = vsn.serial_id
       AND t.status IN ('in_progress', 'on_hold', 'diagnosis_failed', 'out_for_repair')
  );

COMMENT ON VIEW public.asset_available IS
  'Part 2.5 / finding I10. The ONE definition of an attachable asset. Six '
  'inconsistent predicates were replaced by this; do not write a seventh. '
  'NULL inventory_status is excluded deliberately (decision D1): it means "not '
  'yet through GRN" for ~1,345 real laptops, not "probably in stock".';
