-- 180_one_month_rental_security_per_line.sql
-- Store security per SO line (rate × qty) so partial DCs charge only dispatched laptops.

UPDATE sales_order_lines
   SET security_amount = ROUND((COALESCE(rate, 0) * COALESCE(quantity, 1))::numeric, 2)
 WHERE LOWER(COALESCE(security_type, '')) = 'one_month_rental';
