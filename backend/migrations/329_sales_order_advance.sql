-- 329: store the advance the sales order form has always asked for.
--
-- The SO form collected "Advance required?" with an amount and a due date and
-- the server dropped both. Header fields, repeated on every line like the rest
-- of the order header. Additive only: two nullable columns, no backfill.
ALTER TABLE sales_order_lines
  ADD COLUMN IF NOT EXISTS advance_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS advance_due_date DATE;

COMMENT ON COLUMN sales_order_lines.advance_amount IS 'Advance to collect before dispatch (header, repeated per line)';
COMMENT ON COLUMN sales_order_lines.advance_due_date IS 'Date the advance is due';
