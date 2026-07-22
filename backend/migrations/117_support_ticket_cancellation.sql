-- Support ticket cancellation (ERP migration cleanup)
ALTER TABLE support_tickets
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS cancelled_by INTEGER REFERENCES users (user_id),
    ADD COLUMN IF NOT EXISTS cancellation_remark TEXT;

CREATE INDEX IF NOT EXISTS idx_support_tickets_cancelled_at
    ON support_tickets (cancelled_at DESC)
    WHERE status = 'cancelled';
