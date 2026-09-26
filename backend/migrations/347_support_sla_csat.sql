-- Support SLA + CSAT (claude/carret-support.md S5, S6). Keyed to the tickets the
-- running code uses (support_tickets) — the v2 SLA/CSAT/events tables point at
-- support_tickets_v2, which nothing writes.

-- Waiting on the customer (not reachable, asked to reschedule, …): the SLA
-- clock pauses from from_at to to_at. Waiting on a part pauses it too, but that
-- is read from the part requests themselves.
CREATE TABLE IF NOT EXISTS support_ticket_holds (
  id          SERIAL PRIMARY KEY,
  ticket_id   INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  reason      VARCHAR(20) NOT NULL CHECK (reason IN ('customer', 'part', 'other')),
  note        TEXT,
  from_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  to_at       TIMESTAMPTZ,
  created_by  INTEGER,
  released_by INTEGER
);
CREATE INDEX IF NOT EXISTS support_ticket_holds_ticket_idx ON support_ticket_holds (ticket_id);
CREATE UNIQUE INDEX IF NOT EXISTS support_ticket_holds_one_open ON support_ticket_holds (ticket_id) WHERE to_at IS NULL;

-- Customer feedback: one per closed ticket; the link carries the token.
CREATE TABLE IF NOT EXISTS support_csat (
  id            SERIAL PRIMARY KEY,
  ticket_id     INTEGER NOT NULL UNIQUE REFERENCES support_tickets(id) ON DELETE CASCADE,
  token         VARCHAR(64) NOT NULL UNIQUE,
  technician_id INTEGER,
  rating        SMALLINT CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT,
  sent_at       TIMESTAMPTZ,
  send_error    TEXT,
  submitted_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION support_csat_on_close() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed' THEN
    INSERT INTO support_csat (ticket_id, token, technician_id)
    VALUES (
      NEW.id,
      replace(gen_random_uuid()::text, '-', ''),
      (SELECT COALESCE(i.assigned_to, i.pickup_assigned_to) FROM support_ticket_items i
        WHERE i.ticket_id = NEW.id AND COALESCE(i.assigned_to, i.pickup_assigned_to) IS NOT NULL
        ORDER BY i.updated_at DESC NULLS LAST LIMIT 1)
    )
    ON CONFLICT (ticket_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS support_csat_on_close_trg ON support_tickets;
CREATE TRIGGER support_csat_on_close_trg
  AFTER UPDATE OF status ON support_tickets
  FOR EACH ROW EXECUTE FUNCTION support_csat_on_close();
