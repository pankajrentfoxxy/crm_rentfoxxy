BEGIN;

CREATE TABLE IF NOT EXISTS support_settings (
    key VARCHAR(80) PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO support_settings (key, value) VALUES
    ('auto_close_enabled', 'true'::jsonb),
    ('overdue_threshold_hours', '48'::jsonb),
    ('msr91_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE support_tickets
    ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE support_ticket_items
    ADD COLUMN IF NOT EXISTS visited_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE support_ticket_item_audit
    ALTER COLUMN item_id DROP NOT NULL;

COMMIT;
