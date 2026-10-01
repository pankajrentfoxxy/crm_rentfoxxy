-- 413: GSTIN-filled addresses repeated city, state and PIN (2 Oct 2026).
--
-- gstinLookupService joined district, state and PIN into the address line AND
-- returned them as city / state / pincode, so customers and leads filled from a
-- GSTIN carry e.g. "…, Nehru Place, New Delhi, South East Delhi, Delhi, 110019"
-- with the same city / state / PIN in their own fields — and every document,
-- which prints the address followed by those fields, showed them twice.
-- The lookup is fixed; this removes the repeated tail from saved records.
--
-- A tail is removed only when it is EXACTLY ", <city>, <state>, <pin>" or
-- ", <state>, <pin>" built from that same record's own fields (case-insensitive),
-- so nothing is lost: the parts stay in their fields. After such a tail, a last
-- part equal to the city is dropped too (the GST record repeats place/district). Issued invoices and DCs
-- keep their own address copies and are not touched. Old values are kept in
-- address_cleanup_413_backup. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS address_cleanup_413_backup (
  table_name  varchar(30)  NOT NULL,
  row_id      integer      NOT NULL,
  column_name varchar(40)  NOT NULL,
  old_value   text,
  new_value   text,
  backed_up_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION pg_temp.strip_tail(addr text, city text, state text, pin text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE a text := btrim(coalesce(addr, '')); t text;
BEGIN
  IF a = '' OR coalesce(btrim(pin), '') = '' OR coalesce(btrim(state), '') = '' THEN RETURN addr; END IF;
  FOREACH t IN ARRAY ARRAY[
    CASE WHEN coalesce(btrim(city), '') <> '' THEN ', ' || btrim(city) || ', ' || btrim(state) || ', ' || btrim(pin) END,
    ', ' || btrim(state) || ', ' || btrim(pin)
  ] LOOP
    IF t IS NOT NULL AND length(a) > length(t) AND lower(right(a, length(t))) = lower(t) THEN
      a := btrim(left(a, length(a) - length(t)));
      -- The GST record often repeats the place as the district ("…, FARIDABAD,
      -- Faridabad"): once the GST tail is gone, a last part equal to the city
      -- goes too, as the fixed lookup does.
      WHILE coalesce(btrim(city), '') <> '' AND length(a) > length(btrim(city)) + 2
            AND lower(right(a, length(btrim(city)) + 2)) = lower(', ' || btrim(city)) LOOP
        a := btrim(left(a, length(a) - length(btrim(city)) - 2));
      END LOOP;
      RETURN a;
    END IF;
  END LOOP;
  RETURN addr;
END $$;

-- customers: billing, shipping, and the main address (paired with billing fields)
CREATE TEMP TABLE _c ON COMMIT DROP AS
SELECT customer_id AS id,
       billing_address, pg_temp.strip_tail(billing_address, billing_city, billing_state, billing_pincode) AS new_billing,
       shipping_address, pg_temp.strip_tail(shipping_address, shipping_city, shipping_state, shipping_pincode) AS new_shipping,
       address, pg_temp.strip_tail(address, billing_city, billing_state, billing_pincode) AS new_address
  FROM customers;

INSERT INTO address_cleanup_413_backup (table_name, row_id, column_name, old_value, new_value)
SELECT 'customers', id, 'billing_address', billing_address, new_billing FROM _c WHERE new_billing IS DISTINCT FROM billing_address
UNION ALL
SELECT 'customers', id, 'shipping_address', shipping_address, new_shipping FROM _c WHERE new_shipping IS DISTINCT FROM shipping_address
UNION ALL
SELECT 'customers', id, 'address', address, new_address FROM _c WHERE new_address IS DISTINCT FROM address;

UPDATE customers c
   SET billing_address = x.new_billing, shipping_address = x.new_shipping, address = x.new_address
  FROM _c x
 WHERE c.customer_id = x.id
   AND (x.new_billing IS DISTINCT FROM x.billing_address
        OR x.new_shipping IS DISTINCT FROM x.shipping_address
        OR x.new_address IS DISTINCT FROM x.address);

-- leads: one city / state / pincode for both addresses
CREATE TEMP TABLE _l ON COMMIT DROP AS
SELECT lead_id AS id,
       billing_address, pg_temp.strip_tail(billing_address, city, state, pincode) AS new_billing,
       shipping_address, pg_temp.strip_tail(shipping_address, city, state, pincode) AS new_shipping
  FROM leads;

INSERT INTO address_cleanup_413_backup (table_name, row_id, column_name, old_value, new_value)
SELECT 'leads', id, 'billing_address', billing_address, new_billing FROM _l WHERE new_billing IS DISTINCT FROM billing_address
UNION ALL
SELECT 'leads', id, 'shipping_address', shipping_address, new_shipping FROM _l WHERE new_shipping IS DISTINCT FROM shipping_address;

UPDATE leads l
   SET billing_address = x.new_billing, shipping_address = x.new_shipping
  FROM _l x
 WHERE l.lead_id = x.id
   AND (x.new_billing IS DISTINCT FROM x.billing_address OR x.new_shipping IS DISTINCT FROM x.shipping_address);

COMMIT;
