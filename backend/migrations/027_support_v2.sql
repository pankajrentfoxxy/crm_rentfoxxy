BEGIN;

ALTER TABLE support_tickets
    ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'normal',
    ADD COLUMN IF NOT EXISTS top_level_remarks TEXT,
    ADD COLUMN IF NOT EXISTS ticket_phone_override VARCHAR(80),
    ADD COLUMN IF NOT EXISTS ticket_alt_phone VARCHAR(80),
    ADD COLUMN IF NOT EXISTS ticket_email VARCHAR(320),
    ADD COLUMN IF NOT EXISTS ticket_address TEXT;

ALTER TABLE support_ticket_items
    ADD COLUMN IF NOT EXISTS replacement_flagged_by INTEGER REFERENCES users (user_id),
    ADD COLUMN IF NOT EXISTS replacement_flag_reason TEXT,
    ADD COLUMN IF NOT EXISTS replacement_approved_by INTEGER REFERENCES users (user_id),
    ADD COLUMN IF NOT EXISTS replacement_approved_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS source_item_id INTEGER REFERENCES support_ticket_items (id),
    ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMP WITH TIME ZONE;

CREATE TABLE IF NOT EXISTS support_replacement_orders (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES support_tickets (id) ON DELETE CASCADE,
    item_id INTEGER NOT NULL REFERENCES support_ticket_items (id) ON DELETE CASCADE,
    source_item_id INTEGER REFERENCES support_ticket_items (id),
    old_customer_inventory_id INTEGER,
    new_customer_inventory_id INTEGER,
    old_machine_serial VARCHAR(120),
    new_machine_serial VARCHAR(120),
    status VARCHAR(40) NOT NULL DEFAULT 'placed',
    created_by INTEGER REFERENCES users (user_id),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    dispatched_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    inventory_updated_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_support_replacement_orders_ticket ON support_replacement_orders (ticket_id);

ALTER TABLE customer_inventory
    ADD COLUMN IF NOT EXISTS passivated_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS passivated_reason VARCHAR(500);

COMMIT;
