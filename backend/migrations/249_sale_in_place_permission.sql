-- 249_sale_in_place_permission.sql
-- "Report Lost / Buyout" on a customer's Assets tab stops rent and raises a
-- sale-in-place Sales Order in one step (see docs/PHASE21_LOST_LAPTOP_SALE.md).
-- It is an Accounts action, so it gets its own section instead of riding on
-- customer_assets:edit. super_admin passes every check without a row.
-- Additive and idempotent: an existing grant is never overwritten.

INSERT INTO permission_sections (section, description, sort_order)
VALUES ('sale_in_place', 'Lost / Buyout sale — stop rent and create sale order', 87)
ON CONFLICT (section) DO NOTHING;

INSERT INTO role_permissions (role, section, can_view, can_create, can_edit, can_delete)
VALUES ('accounts', 'sale_in_place', true, true, true, false)
ON CONFLICT (role, section) DO NOTHING;
