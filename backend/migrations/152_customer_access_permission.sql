-- 152_customer_access_permission.sql
-- Customer Access (all / sales / rental) as a role permission.
-- Sits alongside data_scope (which stays all/assigned record-ownership scope).
-- Meaningful only on the customers section rows ('customers','customer_management');
-- ignored elsewhere. Default 'all' => zero behavior change until narrowed.

-- Role-level: which customer types this role may access
ALTER TABLE role_permissions
  ADD COLUMN IF NOT EXISTS customer_access VARCHAR(10) NOT NULL DEFAULT 'all';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_role_permissions_customer_access'
  ) THEN
    ALTER TABLE role_permissions
      ADD CONSTRAINT chk_role_permissions_customer_access
      CHECK (customer_access IN ('all', 'sales', 'rental'));
  END IF;
END $$;

-- Optional per-user override (NULL = inherit role)
ALTER TABLE user_permissions
  ADD COLUMN IF NOT EXISTS customer_access VARCHAR(10) DEFAULT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_permissions_customer_access'
  ) THEN
    ALTER TABLE user_permissions
      ADD CONSTRAINT chk_user_permissions_customer_access
      CHECK (customer_access IS NULL OR customer_access IN ('all', 'sales', 'rental'));
  END IF;
END $$;

UPDATE role_permissions SET customer_access = 'all' WHERE customer_access IS NULL;
