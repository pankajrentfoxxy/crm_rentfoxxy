-- 157_inventory_tag_access_granular.sql
-- Expand Ready Stock visibility: rental_only, rental_both, sale_only, sale_both (+ legacy sales/rental).

ALTER TABLE role_permissions
  ALTER COLUMN inventory_tag_access TYPE VARCHAR(20);

ALTER TABLE user_permissions
  ALTER COLUMN inventory_tag_access TYPE VARCHAR(20);

ALTER TABLE role_permissions
  DROP CONSTRAINT IF EXISTS chk_role_permissions_inventory_tag_access;

ALTER TABLE user_permissions
  DROP CONSTRAINT IF EXISTS chk_user_permissions_inventory_tag_access;

UPDATE role_permissions
   SET inventory_tag_access = 'sale_both'
 WHERE inventory_tag_access = 'sales';

UPDATE role_permissions
   SET inventory_tag_access = 'rental_both'
 WHERE inventory_tag_access = 'rental';

UPDATE user_permissions
   SET inventory_tag_access = 'sale_both'
 WHERE inventory_tag_access = 'sales';

UPDATE user_permissions
   SET inventory_tag_access = 'rental_both'
 WHERE inventory_tag_access = 'rental';

ALTER TABLE role_permissions
  ADD CONSTRAINT chk_role_permissions_inventory_tag_access
  CHECK (inventory_tag_access IN (
    'all', 'rental_only', 'rental_both', 'sale_only', 'sale_both', 'sales', 'rental'
  ));

ALTER TABLE user_permissions
  ADD CONSTRAINT chk_user_permissions_inventory_tag_access
  CHECK (inventory_tag_access IS NULL OR inventory_tag_access IN (
    'all', 'rental_only', 'rental_both', 'sale_only', 'sale_both', 'sales', 'rental'
  ));
