-- 156_inventory_tag_access_permission.sql
-- Ready to Rent/Sell visibility: all / sales / rental on inventory_management rows.
-- sales  -> laptops tagged sale or both (hide SO-attached units)
-- rental -> laptops tagged rental or both (hide SO-attached units)
-- all    -> full inventory view (unchanged)

ALTER TABLE role_permissions
  ADD COLUMN IF NOT EXISTS inventory_tag_access VARCHAR(10) NOT NULL DEFAULT 'all';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_role_permissions_inventory_tag_access'
  ) THEN
    ALTER TABLE role_permissions
      ADD CONSTRAINT chk_role_permissions_inventory_tag_access
      CHECK (inventory_tag_access IN ('all', 'sales', 'rental'));
  END IF;
END $$;

ALTER TABLE user_permissions
  ADD COLUMN IF NOT EXISTS inventory_tag_access VARCHAR(10) DEFAULT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_permissions_inventory_tag_access'
  ) THEN
    ALTER TABLE user_permissions
      ADD CONSTRAINT chk_user_permissions_inventory_tag_access
      CHECK (inventory_tag_access IS NULL OR inventory_tag_access IN ('all', 'sales', 'rental'));
  END IF;
END $$;

UPDATE role_permissions SET inventory_tag_access = 'all' WHERE inventory_tag_access IS NULL;
