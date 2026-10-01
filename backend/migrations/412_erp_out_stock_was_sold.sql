-- 412: ERP "out_stock" laptops were SOLD, not rented (2 Oct 2026).
--
-- Migration 258 mapped every ERP out_stock laptop to 'rented' ("read in 12
-- places as deployed"). On the live data copied to QA on 1 Oct that was 95
-- laptops, and none of them is with a customer on rent: no customer, no DC on
-- the asset, no rate, no rent start. Their challan history shows every one went
-- out on a SALE order (gorefurbo) between Feb and 24 Jun 2026 — mostly a rental
-- converted to a sale (rental return + sale DC on the same day), e.g. TTSPL4354:
-- rented to Ratham on SO-000925, sold to Ratham on SO/26-27/0727 (DC/26-27/0731)
-- on 19 Jun. ERP marked them out_stock because they had left for good.
--
-- Rule, per laptop still exactly as 258 left it (rented from out_stock, no
-- customer, no rent start): if its latest sale-order outbound DC (not
-- cancelled; delivered or not) is no older than its latest rental outbound DC,
-- it is SOLD to that DC's customer, on that DC. Anything without a sale DC is
-- left alone and listed by the NOTICE below — never guessed.
--
-- Runs after 258 (on live 258 is still due, so both run at promotion).
-- Every change keeps an audit trail like 258: extra.erp_out_stock_resolution,
-- an inventory_status_transitions row (reason 'erp_out_stock_sold') and an
-- events row. Idempotent: a fixed laptop is no longer 'rented'.

BEGIN;

CREATE TEMP TABLE _oos ON COMMIT DROP AS
SELECT v.serial_id, COALESCE(v.inventory_asset_code, v.extra->>'ttspl_id') AS ttspl_id
  FROM vendor_serial_numbers v
 WHERE v.deleted_at IS NULL
   AND v.extra->>'legacy_status' = 'out_stock'
   AND v.inventory_status = 'rented'
   AND v.current_customer_id IS NULL
   AND v.rent_start_date IS NULL;

-- Every outbound DC that carries one of them (tokens are "serial_id|serial|ttspl").
CREATE TEMP TABLE _oos_dc ON COMMIT DROP AS
SELECT o.serial_id, d.dc_number, d.customer_id, d.customer_name, d.entity_code, d.sales_order_number,
       COALESCE(d.delivered_at, d.created_at) AS at,
       (SELECT MAX(sol.quotation_type) FROM sales_order_lines sol
         WHERE sol.sales_order_number = d.sales_order_number) AS qtype
  FROM _oos o
  JOIN delivery_challan_lines d
    ON d.movement_type = 'outbound'
   AND COALESCE(d.status, '') <> 'cancelled'
   AND jsonb_typeof(d.serial_number) = 'array'
   AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(d.serial_number) e
                WHERE split_part(e, '|', 1) = o.serial_id::text);

CREATE TEMP TABLE _oos_sold ON COMMIT DROP AS
SELECT DISTINCT ON (s.serial_id)
       s.serial_id, o.ttspl_id, s.dc_number, s.customer_id, s.customer_name,
       COALESCE(NULLIF(s.entity_code, ''), 'gorefurbo') AS entity_code, s.sales_order_number, s.at
  FROM _oos_dc s
  JOIN _oos o ON o.serial_id = s.serial_id
 WHERE s.qtype = 'sale'
   AND s.at >= COALESCE((SELECT MAX(r.at) FROM _oos_dc r
                          WHERE r.serial_id = s.serial_id AND r.qtype IS DISTINCT FROM 'sale'), '-infinity')
 ORDER BY s.serial_id, s.at DESC;

UPDATE vendor_serial_numbers v
   SET inventory_status = 'sold',
       current_customer_id = s.customer_id,
       current_dc_number = s.dc_number,
       current_entity = s.entity_code,
       status_changed_at = s.at,
       extra = COALESCE(v.extra, '{}'::jsonb) || jsonb_build_object(
                 'erp_out_stock_resolution', 'sold',
                 'erp_out_stock_sale_dc', s.dc_number,
                 'erp_out_stock_sale_so', s.sales_order_number,
                 'erp_out_stock_resolved_at', NOW()::text),
       updated_at = NOW()
  FROM _oos_sold s
 WHERE v.serial_id = s.serial_id
   AND v.inventory_status = 'rented';

INSERT INTO inventory_status_transitions
  (serial_id, ttspl_id, from_status, to_status, reason, dc_number, customer_id, entity_code, actor_user_id)
SELECT s.serial_id, s.ttspl_id, 'rented', 'sold', 'erp_out_stock_sold', s.dc_number, s.customer_id, s.entity_code, NULL
  FROM _oos_sold s;

INSERT INTO events
  (actor_type, actor_name, entity_type, entity_id, entity_ref,
   event_type, from_state, to_state, payload, source)
SELECT 'migration', 'migration 412', 'asset',
       COALESCE(s.ttspl_id, s.serial_id::text), s.ttspl_id,
       'status_corrected', 'rented', 'sold',
       jsonb_build_object(
         'migration', '412_erp_out_stock_was_sold.sql',
         'serial_id', s.serial_id,
         'legacy_status', 'out_stock',
         'sale_dc', s.dc_number,
         'sale_so', s.sales_order_number,
         'customer', s.customer_name
       ),
       'migration:412'
  FROM _oos_sold s;

DO $$
DECLARE fixed int; left_over text;
BEGIN
  SELECT COUNT(*) INTO fixed FROM _oos_sold;
  SELECT string_agg(COALESCE(o.ttspl_id, o.serial_id::text), ', ') INTO left_over
    FROM _oos o WHERE NOT EXISTS (SELECT 1 FROM _oos_sold s WHERE s.serial_id = o.serial_id);
  RAISE NOTICE '412: % ERP out_stock laptops set to sold; left as rented for review: %', fixed, COALESCE(left_over, 'none');
END $$;

COMMIT;
