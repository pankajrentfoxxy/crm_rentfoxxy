-- Part 5.2 (finding G2) — inventory_status is NULL for a laptop's whole
-- production life, because migration 037 added the column with no default and
-- none of the GRN receive INSERTs set it.
--
-- The consequence is not cosmetic: every availability query reads
-- COALESCE(inventory_status, 'in_stock'), so a unit sitting on the diagnosis
-- bench counts as available to sell.
--
-- The inference is from the ticket's current stage. Every production stage means
-- the same thing for stock purposes — the unit is on the floor, not on the shelf
-- — so they all infer in_repair. A NULL with no ticket at all is left alone:
-- guessing at a unit with no production history would be inventing a fact.
--
-- Rule 5 (every data migration preserves what it overwrites): the prior value is
-- NULL, so there is nothing to keep, but the inference itself is recorded on the
-- row (extra.inventory_status_inferred) and in events, so the backfill can be
-- told apart from a status a human set.
--
-- NOTE ON THE TTSPL ID. vendor_serial_numbers has no ttspl_id column; the asset
-- code lives in inventory_asset_code, with a legacy fallback in extra->>'ttspl_id'.
-- That COALESCE is the convention inventoryStateMachine.loadSerial already uses,
-- and it is the one used below. inventory_status_transitions DOES have its own
-- ttspl_id column, which is what made the mix-up easy.

WITH inferred AS (
  SELECT v.serial_id,
         COALESCE(v.inventory_asset_code, v.extra->>'ttspl_id') AS ttspl_id,
         st.stage_name,
         'in_repair'::varchar AS new_status
    FROM vendor_serial_numbers v
    JOIN tickets t  ON t.vendor_serial_id = v.serial_id
    JOIN stages  st ON st.stage_id = t.current_stage_id
   WHERE v.deleted_at IS NULL
     AND v.spo_id IS NULL
     AND v.inventory_status IS NULL
     AND st.stage_name IN (
       'Floor Manager', 'Diagnosis', 'Chip Level Repair', 'Dismantle',
       'Procurement', 'Body & Paint', 'Assembly & Software', 'Final Testing',
       'QC1', 'QC2', 'Dispatch QC', 'Pending Inventory'
     )
),
stamped AS (
  UPDATE vendor_serial_numbers v
     SET inventory_status  = i.new_status,
         status_changed_at = COALESCE(v.status_changed_at, NOW()),
         updated_at        = NOW(),
         extra             = COALESCE(v.extra, '{}'::jsonb) || jsonb_build_object(
                               'inventory_status_inferred', jsonb_build_object(
                                 'from',       'null',
                                 'to',         i.new_status,
                                 'stage',      i.stage_name,
                                 'migration',  '269',
                                 'inferred_at', to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SSOF')
                               ))
    FROM inferred i
   WHERE v.serial_id = i.serial_id
  RETURNING v.serial_id, i.ttspl_id, i.stage_name, i.new_status
)
INSERT INTO events (
  actor_type, actor_id, actor_name,
  entity_type, entity_id, entity_ref,
  event_type, from_state, to_state,
  payload, correlation_id, source
)
SELECT 'migration', NULL, 'migration 269',
       'asset', COALESCE(s.ttspl_id, s.serial_id::text), s.ttspl_id,
       'inventory_status_backfilled', NULL, s.new_status,
       jsonb_build_object('serial_id', s.serial_id, 'inferred_from_stage', s.stage_name),
       NULL, 'migrations/269_grn_inventory_status_backfill.sql'
  FROM stamped s;

-- Transition rows too, so the asset timeline built in Part 2 does not show a
-- status appearing from nowhere.
INSERT INTO inventory_status_transitions (serial_id, ttspl_id, from_status, to_status, reason)
SELECT v.serial_id,
       COALESCE(v.inventory_asset_code, v.extra->>'ttspl_id'),
       NULL,
       v.inventory_status,
       'Backfilled by migration 269 from ticket stage'
  FROM vendor_serial_numbers v
 WHERE v.extra ? 'inventory_status_inferred'
   AND NOT EXISTS (
     SELECT 1 FROM inventory_status_transitions t
      WHERE t.serial_id = v.serial_id AND t.reason = 'Backfilled by migration 269 from ticket stage'
   );
