BEGIN;

ALTER TABLE support_tickets
    ADD COLUMN IF NOT EXISTS created_by_name VARCHAR(300);

ALTER TABLE support_ticket_items
    ADD COLUMN IF NOT EXISTS current_step VARCHAR(50),
    ADD COLUMN IF NOT EXISTS outcome VARCHAR(30),
    ADD COLUMN IF NOT EXISTS outcome_set_by INTEGER REFERENCES users (user_id),
    ADD COLUMN IF NOT EXISTS outcome_set_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS pod_uploaded_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS warehouse_otp_code VARCHAR(6),
    ADD COLUMN IF NOT EXISTS warehouse_otp_verified_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS pickup_method VARCHAR(20),
    ADD COLUMN IF NOT EXISTS pickup_assigned_to INTEGER REFERENCES users (user_id),
    ADD COLUMN IF NOT EXISTS pickup_courier_name VARCHAR(200),
    ADD COLUMN IF NOT EXISTS pickup_awb VARCHAR(120),
    ADD COLUMN IF NOT EXISTS pickup_completed_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE support_replacement_orders
    ADD COLUMN IF NOT EXISTS complaint_item_id INTEGER REFERENCES support_ticket_items (id),
    ADD COLUMN IF NOT EXISTS pickup_item_id INTEGER REFERENCES support_ticket_items (id),
    ADD COLUMN IF NOT EXISTS dispatch_method VARCHAR(20),
    ADD COLUMN IF NOT EXISTS courier_name VARCHAR(200),
    ADD COLUMN IF NOT EXISTS awb_number VARCHAR(120),
    ADD COLUMN IF NOT EXISTS delivery_otp_code VARCHAR(6),
    ADD COLUMN IF NOT EXISTS delivery_otp_verified_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS warehouse_otp_code VARCHAR(6),
    ADD COLUMN IF NOT EXISTS warehouse_otp_verified_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS flagged_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS out_for_delivery_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS pickup_completed_at TIMESTAMP WITH TIME ZONE;

UPDATE support_replacement_orders ro
SET complaint_item_id = COALESCE(ro.complaint_item_id, ro.source_item_id)
WHERE ro.source_item_id IS NOT NULL;

COMMIT;
