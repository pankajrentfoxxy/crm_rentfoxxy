-- Normalize order_type for Rent / Sales / Demo reporting (column already exists on orders)
UPDATE orders SET order_type = 'Sales' WHERE order_type IS NULL OR TRIM(COALESCE(order_type, '')) = '';
UPDATE orders SET order_type = 'Sales' WHERE order_type NOT IN ('Rent', 'Sales', 'Demo');
