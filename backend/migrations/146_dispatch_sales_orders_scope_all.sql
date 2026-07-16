-- Dispatch needs full visibility of rental/sale sales orders to fulfill them.
-- Legacy sales_orders / sales_orders_doc were set to data_scope=assigned (creator-only),
-- which hid post-July SOs created by sales/support. sales_orders_rental/sale already
-- had data_scope=all; keep all SO sections consistent for dispatch.

UPDATE role_permissions
SET data_scope = 'all'
WHERE role = 'dispatch'
  AND section IN (
    'sales_orders',
    'sales_orders_doc',
    'sales_orders_rental',
    'sales_orders_sale'
  );
