BEGIN;

CREATE TABLE IF NOT EXISTS support_issue_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL UNIQUE,
    active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO support_issue_categories (name, sort_order) VALUES
    ('Hardware / performance', 10),
    ('Display / keyboard / touchpad', 20),
    ('Battery / charging', 30),
    ('Software / OS', 40),
    ('Network / Wi-Fi', 50),
    ('Pickup / return logistics', 60),
    ('Other', 99)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS support_tickets (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL,
    customer_name VARCHAR(500),
    customer_phone VARCHAR(80),
    status VARCHAR(40) NOT NULL DEFAULT 'open',
    created_by INTEGER REFERENCES users (user_id),
    closed_by INTEGER REFERENCES users (user_id),
    closed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_customer ON support_tickets (customer_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets (status);

CREATE TABLE IF NOT EXISTS support_ticket_items (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES support_tickets (id) ON DELETE CASCADE,
    customer_inventory_id INTEGER,
    serial_number VARCHAR(120),
    unique_serial_number VARCHAR(120),
    brand VARCHAR(120),
    model VARCHAR(300),
    ram VARCHAR(120),
    storage VARCHAR(200),
    generation VARCHAR(80),
    item_type VARCHAR(20) NOT NULL,
    issue_category_id INTEGER REFERENCES support_issue_categories (id),
    issue_category_label VARCHAR(120),
    remarks TEXT,
    assigned_to INTEGER REFERENCES users (user_id),
    status VARCHAR(40) NOT NULL DEFAULT 'open',
    otp_code VARCHAR(6),
    otp_verified_at TIMESTAMP WITH TIME ZONE,
    pod_image_path TEXT,
    work_done_at TIMESTAMP WITH TIME ZONE,
    loan_machine_serial VARCHAR(120),
    loan_delivered_at TIMESTAMP WITH TIME ZONE,
    pickup_scheduled_at TIMESTAMP WITH TIME ZONE,
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_support_ticket_items_ticket ON support_ticket_items (ticket_id);
CREATE INDEX IF NOT EXISTS idx_support_ticket_items_assigned ON support_ticket_items (assigned_to);

CREATE TABLE IF NOT EXISTS support_ticket_item_audit (
    id SERIAL PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES support_ticket_items (id) ON DELETE CASCADE,
    ticket_id INTEGER NOT NULL REFERENCES support_tickets (id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users (user_id),
    action VARCHAR(80) NOT NULL,
    detail JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS support_ticket_item_comments (
    id SERIAL PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES support_ticket_items (id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users (user_id),
    author_role VARCHAR(40),
    body TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_support_item_comments_item ON support_ticket_item_comments (item_id);

COMMIT;
