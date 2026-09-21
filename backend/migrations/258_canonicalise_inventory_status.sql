-- Part 2.3 (Decision 3) — canonicalise vendor_serial_numbers.inventory_status.
--
-- PHASE ORDER IS NOT NEGOTIABLE and this file is phase 2 of 3:
--   phase 0  close the bypasses          — Part 2.2, done (the acceptance grep
--                                          returns zero outside the state machine)
--   phase 1  measure                     — docs/status-census.md
--   phase 2  map and migrate             — THIS FILE
--   phase 3  constrain                   — 259, after this has been reviewed
--
-- Adding the CHECK before the mapping would make every unmapped row unwritable;
-- adding it before Part 2.2 would have converted twenty-eight existing bugs into
-- production 500s.
--
-- SCOPE, per decision D2: inventory_status ONLY. qc_status is NOT touched and
-- gets no constraint — Part 1 defines no canonical list for it, and its main
-- writer (qcManagement/orders.controller.js) is rewritten in Part 5.
-- Constraining a column before its writer is fixed turns a data-quality problem
-- into 500s at the QC bench.
--
-- WHAT IS MIGRATED — 120 rows, 1.65% of the live fleet:
--   out_stock      (95) -> rented      read in 12 places as "deployed"; written
--                                      by no current code, an ERP import artefact
--   out_for_repare (19) -> in_repair   misspelling of an existing family
--   out_for_return  (6) -> returned
--
-- WHAT IS DELIBERATELY NOT MIGRATED:
--   NULL (1,372) — decision D1. These are real laptops that have not been
--     through GRN: 1,345 of them have no ticket, no PO, no customer, no brand,
--     no model and ZERO events in all of history. Defaulting them to in_stock
--     would bake in the lie every availability query currently tells through
--     COALESCE(inventory_status,'in_stock') and make uninspected stock
--     attachable. Part 2.5 excludes NULL from the availability predicate; Part
--     5.2 backfills the 27 that do have a ticket by inferring from its stage.
--     The CHECK in 259 therefore permits NULL.
--   deleted (1) — soft-deleted already, and this migration filters
--     deleted_at IS NULL, so it is never seen. The script that writes it
--     (scripts/delete-laptop-by-serial.js) still needs a decision.
--
-- REVERSIBILITY: every changed row keeps its original value in
-- extra.legacy_status, gets an inventory_status_transitions row with
-- reason='canonicalisation', and an events row with
-- event_type='status_canonicalised'. The migration can be reconstructed
-- from any of the three.
--
-- Idempotent: the UPDATE matches only non-canonical values, so a second run
-- changes nothing.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Preserve, then map.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE _canon_map (stray TEXT PRIMARY KEY, canonical TEXT NOT NULL) ON COMMIT DROP;
INSERT INTO _canon_map (stray, canonical) VALUES
  ('out_stock',      'rented'),
  ('out_for_repare', 'in_repair'),
  ('out_for_return', 'returned'),
  -- Not present on this database but mapped so a re-run elsewhere is complete.
  ('out_for_repair', 'in_repair'),
  ('passed',         'in_stock'),
  ('repared',        'in_stock'),
  ('replace',        'returned'),
  ('qc_reject',      'qc_failed'),
  ('require_for_parts', 'scrapped'),
  ('send_to_qc_check',  'qc_failed');

-- The rows about to change, captured before the UPDATE so the audit rows below
-- know what the value WAS.
CREATE TEMP TABLE _canon_changed ON COMMIT DROP AS
SELECT v.serial_id,
       COALESCE(v.inventory_asset_code, v.extra->>'ttspl_id') AS ttspl_id,
       v.inventory_status AS from_status,
       m.canonical        AS to_status,
       v.current_customer_id
  FROM vendor_serial_numbers v
  JOIN _canon_map m ON m.stray = v.inventory_status
 WHERE v.deleted_at IS NULL;

-- extra.legacy_status is set with || rather than a whole-object write: finding
-- I12 means replacing the object loses a concurrent writer's keys.
-- COALESCE on the existing value so a second run never overwrites the ORIGINAL
-- legacy value with an already-canonical one.
UPDATE vendor_serial_numbers v
   SET inventory_status = c.to_status,
       extra = COALESCE(v.extra, '{}'::jsonb) || jsonb_build_object(
                 'legacy_status', COALESCE(v.extra->>'legacy_status', c.from_status),
                 'canonicalised_at', NOW()::text
               ),
       status_changed_at = NOW(),
       updated_at = NOW()
  FROM _canon_changed c
 WHERE v.serial_id = c.serial_id;

-- ---------------------------------------------------------------------------
-- 2. The migration appears in each asset's own timeline rather than as an
--    unexplained jump. Both legacy trails plus the event spine, so whichever
--    one a screen reads, the change is there.
-- ---------------------------------------------------------------------------
INSERT INTO inventory_status_transitions
  (serial_id, ttspl_id, from_status, to_status, reason, customer_id, actor_user_id)
SELECT c.serial_id, c.ttspl_id, c.from_status, c.to_status,
       'canonicalisation', c.current_customer_id, NULL
  FROM _canon_changed c;

INSERT INTO events
  (actor_type, actor_name, entity_type, entity_id, entity_ref,
   event_type, from_state, to_state, payload, source)
SELECT 'migration', 'migration 258', 'asset',
       COALESCE(c.ttspl_id, c.serial_id::text), c.ttspl_id,
       'status_canonicalised', c.from_status, c.to_status,
       jsonb_build_object(
         'migration', '258_canonicalise_inventory_status.sql',
         'serial_id', c.serial_id,
         'legacy_status', c.from_status
       ),
       'migration:258'
  FROM _canon_changed c;

COMMIT;
