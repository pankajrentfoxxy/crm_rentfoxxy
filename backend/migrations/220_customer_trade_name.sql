-- Customer trade name from GST API tradeNam (filled when GST is added/updated).
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS trade_name VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_customers_trade_name
  ON customers (trade_name)
  WHERE trade_name IS NOT NULL AND TRIM(trade_name) <> '';
