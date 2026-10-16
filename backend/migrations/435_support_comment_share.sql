-- 435: Comments shared with the customer (16 Oct 2026).
-- Support comments are internal by default; one ticked "Share with customer"
-- shows on the customer portal's ticket page. Additive only.
ALTER TABLE support_ticket_item_comments ADD COLUMN IF NOT EXISTS shared_with_customer BOOLEAN NOT NULL DEFAULT FALSE;
