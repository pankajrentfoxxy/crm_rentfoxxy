-- Part 2.3 phase 3 — constrain inventory_status.
--
-- This is the last of the three phases and it must not run before the other
-- two. 258 mapped the 120 stray rows; Part 2.2 made transitionAsset the only
-- writer (the acceptance grep returns zero outside the state machine). Adding
-- this constraint before either would have turned existing bugs into 500s.
--
-- Twelve canonical values, from Part 1 §6.2 and backend/constants/statuses.js.
-- `at_gate` is included even though nothing writes it yet: Part 3 introduces it
-- (Decision 4, guard custody), and adding it now means Part 3 does not need a
-- migration to widen a constraint it is about to rely on. A value in the
-- constraint that nothing writes is harmless; a missing one is an outage.
--
-- NULL IS PERMITTED, deliberately — decision D1.
--
-- 1,372 rows carry NULL and 1,345 of them are real laptops that have not been
-- through GRN: no ticket, no PO, no customer, no brand, no model, and zero
-- events in all of history. NULL is the honest value for "has not entered stock
-- yet"; it is not a gap to be defaulted away. Part 2.5 excludes NULL from the
-- availability predicate, which is what stops them reading as in_stock, and
-- Part 5.2 backfills the 27 that do have a ticket.
--
-- If NULL later becomes a named thirteenth status (`awaiting_grn`), that is a
-- change to Part 1's canonical twelve and needs a lifecycle family assigned —
-- it is an open question in docs/decisions-log.md, not something to slip in
-- here.
--
-- SOFT-DELETED ROWS ARE OUT OF SCOPE.
--
-- One soft-deleted row carries inventory_status='deleted', written by
-- scripts/delete-laptop-by-serial.js (bypass-register section E). Decision D1
-- says to leave it: mapping it would lose the only record of why that row is
-- gone, and it is invisible to every query in the application, all of which
-- filter deleted_at IS NULL.
--
-- The alternative — rewriting the value so the constraint can be unconditional
-- — would be tidier and less honest. The constraint governs live assets, which
-- is what it is for. The script that writes the value still needs a decision;
-- until then a scoped constraint states the real rule rather than pretending
-- the exception does not exist.
--
-- NOT VALID is deliberately NOT used. The table is 7,266 rows; a full
-- validation is milliseconds, and a constraint that has not been validated
-- gives false confidence about data that was never checked.

ALTER TABLE public.vendor_serial_numbers
  DROP CONSTRAINT IF EXISTS vendor_serial_numbers_inventory_status_check;

ALTER TABLE public.vendor_serial_numbers
  ADD CONSTRAINT vendor_serial_numbers_inventory_status_check
  CHECK (
    deleted_at IS NOT NULL
    OR inventory_status IS NULL
    OR inventory_status IN (
      'in_stock',
      'reserved',
      'dispatch_ready',
      'at_gate',
      'in_transit',
      'rented',
      'on_demo',
      'sold',
      'returned',
      'in_repair',
      'qc_failed',
      'scrapped'
    )
  );

COMMENT ON CONSTRAINT vendor_serial_numbers_inventory_status_check
  ON public.vendor_serial_numbers IS
  'Part 2.3 / Decision 3. Twelve canonical values. NULL is permitted because it '
  'means "not yet through GRN" for ~1,345 real laptops (decision D1), not '
  '"unknown". Soft-deleted rows are out of scope: one carries a legacy '
  '"deleted" value from scripts/delete-laptop-by-serial.js. Write only through '
  'services/inventoryStateMachine.transitionAsset.';
