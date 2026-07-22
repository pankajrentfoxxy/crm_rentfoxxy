-- Role-permission UI: show Sale and Rental instead of legacy sales_orders_doc.
UPDATE permission_sections
SET description = 'Sales Order – Sale',
    sort_order = 45
WHERE section = 'sales_orders_sale';

UPDATE permission_sections
SET description = 'Sales Order – Rental',
    sort_order = 46
WHERE section = 'sales_orders_rental';

UPDATE permission_sections
SET description = 'Sales Orders (legacy — use Sale/Rental)',
    sort_order = 999
WHERE section = 'sales_orders_doc';

UPDATE permission_sections
SET sort_order = 998
WHERE section = 'sales_orders';
