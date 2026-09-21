-- Part 2.1 (Decision 5) — one append-only event table.
--
-- The thing actually wanted is a timeline per laptop and per document. A
-- laptop's life crosses PO, GRN, production, QC, sales order, DC, gate,
-- delivery, support, return and billing. With per-module tables that timeline is
-- a UNION of eight queries that has to be edited every time a module is added.
--
-- There is direct evidence in this codebase that per-module is the wrong shape:
-- ttspl_audit_log was an attempt at exactly this and works where it is used,
-- inventory_status_transitions is the per-module version of the same thing, and
-- the two now DISAGREE (finding I15) — the super-admin override writes the
-- event and not the transition, support cancel writes the transition and not
-- the event. Two partial logs that cannot be joined is the per-module outcome,
-- already observed.
--
-- HOLD THIS DISTINCTION OR THE WHOLE THING COLLAPSES:
--   state lives in columns, history lives in events.
-- qc_results, payment_records and sales_order_serials keep holding business
-- state. Nothing reads current state out of the event log. If people start
-- doing that, the problem has been rebuilt in a new shape.
--
-- This migration is additive: it creates a table, two indexes and a guard
-- trigger, and writes nothing to any existing table. The backfill is a separate
-- migration (257) so this one can be reviewed on its own.

CREATE TABLE IF NOT EXISTS public.events (
  event_id       BIGSERIAL PRIMARY KEY,
  occurred_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- user | system | courier | customer | migration
  actor_type     TEXT        NOT NULL,
  actor_id       INTEGER,
  -- Denormalised deliberately: an event must still name its actor after that
  -- user row is deleted. A join that can return NULL is not an audit trail.
  actor_name     TEXT,

  -- asset | ticket | so | dc | invoice | support_ticket | po | grn
  entity_type    TEXT        NOT NULL,
  entity_id      TEXT        NOT NULL,
  -- The human handle: TTSPL4227, DC/26-27/0778. Also denormalised, for the
  -- same reason — a timeline has to be readable without eight joins.
  entity_ref     TEXT,

  event_type     TEXT        NOT NULL,
  from_state     TEXT,
  to_state       TEXT,
  payload        JSONB       NOT NULL DEFAULT '{}'::jsonb,

  -- THE POINT OF THE TABLE. One request, one id, on every event it writes.
  -- It is what makes "one delivery wrote five rows from five paths" visible,
  -- and then provable once Part 3 has fixed it.
  correlation_id UUID,

  -- The module or service that wrote it.
  source         TEXT        NOT NULL
);

-- The timeline query: one entity, newest first.
CREATE INDEX IF NOT EXISTS idx_events_entity
  ON public.events (entity_type, entity_id, occurred_at DESC);

-- The fleet-wide query behind the Event Log screen (Part 6.4).
CREATE INDEX IF NOT EXISTS idx_events_type
  ON public.events (event_type, occurred_at DESC);

-- Finding one business event's whole correlated set is how you prove the
-- duplicate-write problem is gone, so it needs its own index.
CREATE INDEX IF NOT EXISTS idx_events_correlation
  ON public.events (correlation_id, occurred_at)
  WHERE correlation_id IS NOT NULL;

-- Append-only, enforced by the database rather than by convention.
--
-- A code convention is what the state machine already is, and it is bypassed 28
-- times (claude/bypass-register.md). An event log that can be edited is not an
-- audit trail, so this is a trigger and not a comment.
--
-- Deliberately a trigger rather than a RULE: a RULE on DELETE silently turns
-- the delete into a no-op, and silence is the failure mode this whole table
-- exists to remove. This raises.
CREATE OR REPLACE FUNCTION public.events_are_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'events is append-only: % on events is not permitted (event_id %)',
    TG_OP, COALESCE(OLD.event_id, NEW.event_id)
    USING HINT = 'Correct a wrong event by appending a corrective one, never by editing history.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_events_no_update ON public.events;
CREATE TRIGGER trg_events_no_update
  BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.events_are_append_only();

DROP TRIGGER IF EXISTS trg_events_no_delete ON public.events;
CREATE TRIGGER trg_events_no_delete
  BEFORE DELETE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.events_are_append_only();

COMMENT ON TABLE public.events IS
  'Append-only narrative layer (Decision 5). State lives in columns, history '
  'lives here. Never read current state from this table. UPDATE and DELETE are '
  'blocked by trigger; correct a wrong event by appending a corrective one.';

COMMENT ON COLUMN public.events.correlation_id IS
  'One request / one transaction. Every event written by the same business '
  'action shares it, which is what makes a duplicate write visible.';
