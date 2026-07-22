-- ============================================================================
-- Migration 077 — Security deposit type on quotations & sales orders.
-- 'none' = no security; 'one_month_rental' = auto = sum(rate*qty) of rental lines.
-- ============================================================================
ALTER TABLE sales_quotations  ADD COLUMN IF NOT EXISTS security_type VARCHAR(20) DEFAULT 'none';
ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS security_type VARCHAR(20) DEFAULT 'none';
