-- 355: customer tag (Rental / Sales / Both) follows what the customer does
-- (claude/carret-customers-returns-control.md, CU1).
--
-- customers.customer_type was a manual flag, defaulting to 'both', that lead
-- conversion never set — ~43 customers disagreed with their own orders. It now
-- follows activity: a rental or demo order, a laptop with them on rent / demo,
-- or a return challan → rental; a sale order or a sold laptop → sales; both →
-- both. No activity keeps what is there. An admin can still fix a tag by hand
-- (customer_type_source = 'manual'), which automatic refreshes leave alone.

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS customer_type_source VARCHAR(10) NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS customer_type_reason TEXT,
  ADD COLUMN IF NOT EXISTS customer_type_set_by INTEGER,
  ADD COLUMN IF NOT EXISTS customer_type_set_at TIMESTAMPTZ;
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_customer_type_source_check;
ALTER TABLE customers ADD CONSTRAINT customers_customer_type_source_check
  CHECK (customer_type_source IN ('auto', 'manual'));

CREATE OR REPLACE FUNCTION derived_customer_type(p_customer_id INTEGER) RETURNS VARCHAR AS $$
DECLARE
  is_rental BOOLEAN;
  is_sale BOOLEAN;
BEGIN
  SELECT EXISTS (
           SELECT 1 FROM sales_order_lines
            WHERE customer_id = p_customer_id
              AND LOWER(COALESCE(quotation_type, '')) IN ('rental', 'demo')
              AND LOWER(COALESCE(status, '')) <> 'cancelled')
      OR EXISTS (
           SELECT 1 FROM vendor_serial_numbers
            WHERE current_customer_id = p_customer_id AND deleted_at IS NULL
              AND inventory_status IN ('rented', 'on_demo'))
      OR EXISTS (
           SELECT 1 FROM delivery_challan_lines
            WHERE customer_id = p_customer_id AND movement_type = 'return'
              AND LOWER(COALESCE(status, '')) <> 'cancelled'),
         EXISTS (
           SELECT 1 FROM sales_order_lines
            WHERE customer_id = p_customer_id
              AND LOWER(COALESCE(quotation_type, '')) IN ('sale', 'sales')
              AND LOWER(COALESCE(status, '')) <> 'cancelled')
      OR EXISTS (
           SELECT 1 FROM vendor_serial_numbers
            WHERE current_customer_id = p_customer_id AND deleted_at IS NULL
              AND inventory_status = 'sold')
    INTO is_rental, is_sale;
  IF is_rental AND is_sale THEN RETURN 'both'; END IF;
  IF is_rental THEN RETURN 'rental'; END IF;
  IF is_sale THEN RETURN 'sales'; END IF;
  RETURN NULL; -- no activity: keep what is there
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION refresh_customer_type(p_customer_id INTEGER) RETURNS VOID AS $$
DECLARE
  d VARCHAR;
BEGIN
  IF p_customer_id IS NULL THEN RETURN; END IF;
  d := derived_customer_type(p_customer_id);
  IF d IS NULL THEN RETURN; END IF;
  UPDATE customers
     SET customer_type = d, customer_type_set_at = NOW(), updated_at = NOW()
   WHERE customer_id = p_customer_id
     AND customer_type_source = 'auto'
     AND customer_type IS DISTINCT FROM d;
END;
$$ LANGUAGE plpgsql;

-- Any order line (all SO paths: new order, replacement, in-place sale) refreshes its customer.
CREATE OR REPLACE FUNCTION trg_sol_refresh_customer_type() RETURNS trigger AS $$
BEGIN
  PERFORM refresh_customer_type(NEW.customer_id);
  IF TG_OP = 'UPDATE' AND OLD.customer_id IS DISTINCT FROM NEW.customer_id THEN
    PERFORM refresh_customer_type(OLD.customer_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sol_customer_type ON sales_order_lines;
CREATE TRIGGER trg_sol_customer_type
  AFTER INSERT OR UPDATE OF quotation_type, status, customer_id ON sales_order_lines
  FOR EACH ROW EXECUTE FUNCTION trg_sol_refresh_customer_type();

-- Backfill every customer the automatic rule owns.
SELECT refresh_customer_type(customer_id) FROM customers WHERE customer_type_source = 'auto';
