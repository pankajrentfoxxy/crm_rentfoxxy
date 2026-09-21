-- Part 4.4 — correct asset_available's allocation clause.
--
-- THIS FIXES A REGRESSION I INTRODUCED IN MIGRATION 260.
--
-- That view excluded any serial with an allocation in ('attached','dispatched'),
-- reasoning from finding S4 that a dispatched allocation still blocks a second
-- attach. The reasoning was right about the risk and wrong about the data.
--
-- `dispatched` is not a terminal, closed state on this system: it is left on
-- the allocation when a delivery completes and nothing ever closes it. A laptop
-- rented three times legitimately carries three dispatched rows. Measured:
-- 1,172 serials hold more than one active allocation, 1,475 surplus rows in
-- total, and every one of them is `dispatched`.
--
-- The consequence of 260 was that 169 laptops which had come back, passed
-- through and were sitting in_stock were invisible to every availability query
-- — hidden by an allocation from a rental that ended months ago.
--
-- The correct rule is narrower. `attached` is a live promise and must block.
-- `dispatched` on a unit whose status is already `in_stock` describes a
-- completed cycle, and the view ALREADY requires inventory_status='in_stock' —
-- so by the time that clause is reached, a dispatched allocation is history.
--
-- Note for Part 4.4's index work: uq_sos_serial_active CANNOT simply be widened
-- to cover `dispatched`, as the plan suggests, for the same reason. 1,475 rows
-- would violate it on day one. Closing S4 properly means closing allocations
-- when a delivery completes, which is a separate change with its own backfill.

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

  -- Canonical and on the shelf. NULL is NOT in stock (decision D1): 1,345 real
  -- laptops have never been through GRN.
  AND vsn.inventory_status = 'in_stock'

  -- qc_status is deliberately not tested (decision D5). in_stock is DEFINED as
  -- QC-passed, and D2 declared qc_status unreliable until Part 5 rewrites its
  -- writer. Of 1,930 in-stock units only 48 carry qc_status='passed'.
  AND vsn.current_customer_id IS NULL

  AND COALESCE(vsn.extra->>'awaiting_inventory_receive', 'false') <> 'true'

  -- A live promise. ONLY 'attached' — see the note above on why 'dispatched'
  -- cannot be included without hiding 169 units that are genuinely back.
  AND NOT EXISTS (
    SELECT 1
      FROM public.sales_order_serials sos
     WHERE sos.serial_id = vsn.serial_id
       AND sos.status = 'attached'
  )

  -- On the floor.
  AND NOT EXISTS (
    SELECT 1
      FROM public.tickets t
     WHERE t.vendor_serial_id = vsn.serial_id
       AND t.status IN ('in_progress', 'on_hold', 'diagnosis_failed', 'out_for_repair')
  );

COMMENT ON VIEW public.asset_available IS
  'Part 2.5 / I10, corrected in 263. The ONE definition of an attachable asset; '
  'do not write a second. Excludes NULL inventory_status (decision D1) and live '
  '"attached" allocations, but NOT "dispatched" — dispatched is never closed on '
  'this system, so a re-rented laptop carries several and excluding them hid '
  '169 units that were back on the shelf.';
