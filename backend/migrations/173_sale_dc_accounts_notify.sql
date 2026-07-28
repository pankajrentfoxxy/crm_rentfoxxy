-- 173_sale_dc_accounts_notify.sql
-- Track manual "Send mail to accounts" from dispatch on sale DCs.

ALTER TABLE delivery_challan_lines
  ADD COLUMN IF NOT EXISTS accounts_notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accounts_notified_by INT REFERENCES users(user_id);
