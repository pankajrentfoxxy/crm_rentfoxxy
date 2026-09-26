-- Support S7 (claude/carret-support.md): when the floor finishes the repair of
-- a laptop a customer sent in (the floor ticket opened by the support pickup
-- closes as completed), the support laptop row is stamped "repaired — ready to
-- return", so the lead's list shows it and the Service DC can be raised. It
-- used to be discovered only by trying to raise the Service DC (U13).
-- A trigger, so every path that completes a floor ticket is covered.
ALTER TABLE support_ticket_items
  ADD COLUMN IF NOT EXISTS repair_ready_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION support_repair_ready_from_floor() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    UPDATE support_ticket_items
       SET repair_ready_at = COALESCE(repair_ready_at, NOW()), updated_at = NOW()
     WHERE floor_ticket_id = NEW.ticket_id
       AND item_type = 'pickup'
       AND status = 'awaiting_service_return';
    INSERT INTO support_ticket_item_audit (item_id, ticket_id, user_id, action, detail, created_at)
    SELECT id, ticket_id, NULL, 'repair_ready', jsonb_build_object('floor_ticket_id', NEW.ticket_id), NOW()
      FROM support_ticket_items
     WHERE floor_ticket_id = NEW.ticket_id AND item_type = 'pickup' AND status = 'awaiting_service_return';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS support_repair_ready_trg ON tickets;
CREATE TRIGGER support_repair_ready_trg
  AFTER UPDATE OF status ON tickets
  FOR EACH ROW EXECUTE FUNCTION support_repair_ready_from_floor();

-- Laptops already repaired and waiting today.
UPDATE support_ticket_items i
   SET repair_ready_at = COALESCE(t.updated_at, NOW())
  FROM tickets t
 WHERE t.ticket_id = i.floor_ticket_id AND t.status = 'completed'
   AND i.item_type = 'pickup' AND i.status = 'awaiting_service_return' AND i.repair_ready_at IS NULL;
