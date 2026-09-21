-- Part 2.1 — backfill the event spine from the two partial logs.
--
-- ttspl_audit_log and inventory_status_transitions are the two trails that
-- exist today, and they disagree (finding I15): the super-admin override writes
-- the event and not the transition, support cancel writes the transition and
-- not the event. Neither is complete on its own and they cannot be joined,
-- which is the per-module outcome Decision 5 is a reaction to.
--
-- Both are copied in with actor_type='migration' so a backfilled row is never
-- mistaken for one written live. Both old tables stay in place and readable for
-- one release, per Decision 5; dropping them is a separate, announced change.
--
-- Idempotent: each source row carries its origin in payload, and the insert
-- skips anything already copied. Re-running changes nothing.

-- ---------------------------------------------------------------------------
-- 1. ttspl_audit_log — the richer of the two. Has an actor name and a
--    description, but no from/to pair.
-- ---------------------------------------------------------------------------
INSERT INTO public.events (
  occurred_at, actor_type, actor_id, actor_name,
  entity_type, entity_id, entity_ref,
  event_type, from_state, to_state, payload, correlation_id, source
)
SELECT
  a.created_at,
  'migration',
  a.actor_user_id,
  -- The original actor is preserved in actor_name even though actor_type says
  -- migration: the row IS a migration artefact, but it still knows who did the
  -- thing it describes.
  COALESCE(NULLIF(a.actor_name, ''), 'unknown'),
  'asset',
  COALESCE(NULLIF(a.ttspl_id, ''), a.vendor_serial_id::text),
  a.ttspl_id,
  a.event_type,
  NULL,
  NULL,
  jsonb_build_object(
    'backfilled_from', 'ttspl_audit_log',
    'source_id',       a.log_id,
    'description',     a.description,
    'serial_id',       a.vendor_serial_id
  ) || COALESCE(a.metadata, '{}'::jsonb),
  NULL,
  'backfill:ttspl_audit_log'
FROM public.ttspl_audit_log a
WHERE COALESCE(NULLIF(a.ttspl_id, ''), a.vendor_serial_id::text) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.source = 'backfill:ttspl_audit_log'
       AND (e.payload->>'source_id')::bigint = a.log_id
  );

-- ---------------------------------------------------------------------------
-- 2. inventory_status_transitions — poorer on context, but it is the only
--    place a from/to pair exists, which is exactly what a timeline needs.
-- ---------------------------------------------------------------------------
INSERT INTO public.events (
  occurred_at, actor_type, actor_id, actor_name,
  entity_type, entity_id, entity_ref,
  event_type, from_state, to_state, payload, correlation_id, source
)
SELECT
  t.created_at,
  'migration',
  t.actor_user_id,
  COALESCE(u.name, 'system'),
  'asset',
  COALESCE(NULLIF(t.ttspl_id, ''), t.serial_id::text),
  t.ttspl_id,
  'status_changed',
  t.from_status,
  t.to_status,
  jsonb_build_object(
    'backfilled_from', 'inventory_status_transitions',
    'source_id',       t.transition_id,
    'reason',          t.reason,
    'dc_number',       t.dc_number,
    'customer_id',     t.customer_id,
    'entity_code',     t.entity_code,
    'serial_id',       t.serial_id
  ),
  NULL,
  'backfill:inventory_status_transitions'
FROM public.inventory_status_transitions t
LEFT JOIN public.users u ON u.user_id = t.actor_user_id
WHERE COALESCE(NULLIF(t.ttspl_id, ''), t.serial_id::text) IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.events e
     WHERE e.source = 'backfill:inventory_status_transitions'
       AND (e.payload->>'source_id')::bigint = t.transition_id
  );

-- ---------------------------------------------------------------------------
-- 3. Correct the append-only probe from migration 256 the only way the table
--    allows: by appending. It cannot be deleted, which is the point.
-- ---------------------------------------------------------------------------
INSERT INTO public.events (
  actor_type, entity_type, entity_id, entity_ref,
  event_type, payload, source
)
SELECT
  'migration', 'asset', 'TEST-1', 'TEST-1',
  'append_only_probe_retracted',
  jsonb_build_object(
    'retracts',  e.event_id,
    'reason',    'Verification row written while proving the append-only trigger. Not a real asset.'
  ),
  'migration:257'
FROM public.events e
WHERE e.entity_id = 'TEST-1'
  AND e.event_type = 'append_only_probe'
  AND NOT EXISTS (
    SELECT 1 FROM public.events r
     WHERE r.event_type = 'append_only_probe_retracted'
       AND (r.payload->>'retracts')::bigint = e.event_id
  );
