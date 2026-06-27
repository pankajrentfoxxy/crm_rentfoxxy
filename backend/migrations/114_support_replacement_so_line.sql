-- Link each replacement order row to its SO line (config-only SO at initiate).
BEGIN;
ALTER TABLE support_replacement_orders
  ADD COLUMN IF NOT EXISTS sales_order_line_id INT;
COMMIT;
