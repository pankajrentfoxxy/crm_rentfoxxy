-- Support safety (claude/carret-support.md, S12 / U1 U2 U15 U17).
-- Every status the running code writes is listed (collected from every
-- UPDATE/INSERT on these tables, 26 Sep 2026, and every value in the data);
-- anything else is refused. Every status change of a support laptop row is
-- written to support_ticket_item_audit as from → to, whoever made it — the
-- existing audit only had free-text actions.

ALTER TABLE support_ticket_items DROP CONSTRAINT IF EXISTS support_ticket_items_status_check;
ALTER TABLE support_ticket_items ADD CONSTRAINT support_ticket_items_status_check CHECK (status IN (
  'open', 'assigned', 'pending_dispatch', 'visited', 'work_done', 'awaiting_otp', 'reached',
  'repair_failed', 'picked_up', 'in_transit', 'awaiting_service_return', 'resolved',
  'inventory_updated', 'delivered', 'closed', 'removed', 'cancelled', 'order_placed',
  'swap_initiated', 'dispatched'
));

-- U15: pickup writes 'repair_required' while setOutcome allowed three values — both are real.
ALTER TABLE support_ticket_items DROP CONSTRAINT IF EXISTS support_ticket_items_outcome_check;
ALTER TABLE support_ticket_items ADD CONSTRAINT support_ticket_items_outcome_check CHECK (
  outcome IS NULL OR outcome IN ('fixed', 'working', 'replacement_required', 'repair_required')
);

ALTER TABLE support_tickets DROP CONSTRAINT IF EXISTS support_tickets_status_check;
ALTER TABLE support_tickets ADD CONSTRAINT support_tickets_status_check CHECK (status IN (
  'open', 'in_progress', 'closed', 'cancelled'
));

-- U2: the replacement-order status came straight from the request body.
ALTER TABLE support_replacement_orders DROP CONSTRAINT IF EXISTS support_replacement_orders_status_check;
ALTER TABLE support_replacement_orders ADD CONSTRAINT support_replacement_orders_status_check CHECK (status IN (
  'order_placed', 'dispatched', 'delivered', 'completed', 'inventory_updated', 'cancelled'
));

-- U17: from → to on every status change. The acting user is taken from the
-- transaction setting app.user_id when the code sets it; NULL otherwise.
CREATE OR REPLACE FUNCTION support_item_status_audit() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO support_ticket_item_audit (item_id, ticket_id, user_id, action, detail, created_at)
    VALUES (
      NEW.id, NEW.ticket_id,
      NULLIF(current_setting('app.user_id', true), '')::int,
      'status_changed',
      jsonb_build_object('from', OLD.status, 'to', NEW.status),
      NOW()
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS support_item_status_audit_trg ON support_ticket_items;
CREATE TRIGGER support_item_status_audit_trg
  AFTER UPDATE OF status ON support_ticket_items
  FOR EACH ROW EXECUTE FUNCTION support_item_status_audit();
