-- 407: Customer's default security deposit, in months of rent.
--
-- Chosen when a lead is won (Deal / Demo) and editable on the customer at any
-- time. A new rental / demo sales order starts from it (None, 1, 2 or 3
-- months); the salesperson can lower or remove it per order. Orders already
-- raised keep their own security_type / security_amount — nothing is
-- recalculated here. NULL = never set (orders start at None, as before).
--
-- sales_order_lines.security_type gains 'two_month_rental' and
-- 'three_month_rental' next to 'none' and 'one_month_rental' (VARCHAR(20),
-- no constraint to change). Additive only.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS security_deposit_months SMALLINT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_security_deposit_months_chk') THEN
    ALTER TABLE customers
      ADD CONSTRAINT customers_security_deposit_months_chk
      CHECK (security_deposit_months IS NULL OR security_deposit_months BETWEEN 0 AND 3);
  END IF;
END $$;
