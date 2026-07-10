-- 138_support_ticket_items_processor.sql
-- Replacement items store laptop config on support_ticket_items (initiateReplacement).

ALTER TABLE support_ticket_items
  ADD COLUMN IF NOT EXISTS processor VARCHAR(200);
