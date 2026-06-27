-- ============================================================
-- Migration 109: Remove test / duplicate SO + DC records
--   SO/26-27/0780, SO-000060  (full sales order removal)
--   DC/26-27/0779             (delivery challan only — SO/26-27/0779 kept)
-- Idempotent: safe to re-run.
-- ============================================================

BEGIN;

CREATE TEMP TABLE _purge_so (sales_order_number TEXT PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _purge_so (sales_order_number) VALUES
  ('SO/26-27/0780'),
  ('SO-000060')
ON CONFLICT DO NOTHING;

CREATE TEMP TABLE _purge_dc (dc_number TEXT PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _purge_dc (dc_number)
SELECT DISTINCT dc_number FROM (
  SELECT dcl.dc_number
    FROM delivery_challan_lines dcl
    JOIN _purge_so ps ON ps.sales_order_number = dcl.sales_order_number
  UNION
  SELECT 'DC/26-27/0779'
) x
WHERE dc_number IS NOT NULL AND TRIM(dc_number) <> ''
ON CONFLICT DO NOTHING;

-- Collect QC ticket ids tied to these documents
CREATE TEMP TABLE _purge_tickets (ticket_id INT PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _purge_tickets (ticket_id)
SELECT DISTINCT ticket_id FROM (
  SELECT dqt.ticket_id
    FROM dc_qc_tickets dqt
    JOIN _purge_dc pd ON pd.dc_number = dqt.dc_number
  UNION
  SELECT dqt.ticket_id
    FROM dc_qc_tickets dqt
    JOIN _purge_so ps ON ps.sales_order_number = dqt.sales_order_number
  UNION
  SELECT sos.qc_ticket_id
    FROM sales_order_serials sos
    JOIN _purge_so ps ON ps.sales_order_number = sos.sales_order_number
   WHERE sos.qc_ticket_id IS NOT NULL
  UNION
  SELECT t.ticket_id
    FROM tickets t
    JOIN _purge_so ps ON ps.sales_order_number = t.sales_order_number
) q
WHERE ticket_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Serials to release back to stock
CREATE TEMP TABLE _purge_serials (serial_id INT PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _purge_serials (serial_id)
SELECT DISTINCT serial_id FROM (
  SELECT sos.serial_id
    FROM sales_order_serials sos
    JOIN _purge_so ps ON ps.sales_order_number = sos.sales_order_number
   WHERE sos.serial_id IS NOT NULL
  UNION
  SELECT sos.serial_id
    FROM sales_order_serials sos
    JOIN _purge_dc pd ON pd.dc_number = sos.dc_number
   WHERE sos.serial_id IS NOT NULL
  UNION
  SELECT vsn.serial_id
    FROM vendor_serial_numbers vsn
    JOIN _purge_dc pd ON pd.dc_number = vsn.current_dc_number
   WHERE vsn.deleted_at IS NULL
) s
WHERE serial_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Null FKs pointing at tickets / DCs
UPDATE delivery_challan_lines dcl
   SET pre_dispatch_qc_ticket_id = NULL
 WHERE dcl.dc_number IN (SELECT dc_number FROM _purge_dc)
    OR dcl.sales_order_number IN (SELECT sales_order_number FROM _purge_so);

UPDATE sales_order_serials sos
   SET qc_ticket_id = NULL
 WHERE sos.sales_order_number IN (SELECT sales_order_number FROM _purge_so);

UPDATE support_ticket_items sti
   SET return_dc_number = NULL,
       updated_at = NOW()
 WHERE sti.return_dc_number IN (SELECT dc_number FROM _purge_dc);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'support_tickets') THEN
    EXECUTE $q$
      UPDATE support_tickets
         SET return_dc_number = NULL
       WHERE return_dc_number IN (SELECT dc_number FROM _purge_dc)
    $q$;
  END IF;
END $$;

-- Support / demo / billing satellites
DELETE FROM support_replacement_orders
 WHERE sales_order_number IN (SELECT sales_order_number FROM _purge_so)
    OR dc_number IN (SELECT dc_number FROM _purge_dc)
    OR new_dc_number IN (SELECT dc_number FROM _purge_dc);

DELETE FROM demo_agreements
 WHERE sales_order_number IN (SELECT sales_order_number FROM _purge_so)
    OR dc_number IN (SELECT dc_number FROM _purge_dc);

DELETE FROM customer_security_deposits
 WHERE sales_order_number IN (SELECT sales_order_number FROM _purge_so);

DELETE FROM sales_order_payments
 WHERE sales_order_number IN (SELECT sales_order_number FROM _purge_so);

-- E-invoice / e-way / courier rows
DELETE FROM einvoice_records WHERE dc_number IN (SELECT dc_number FROM _purge_dc);
DELETE FROM eway_bill_records WHERE dc_number IN (SELECT dc_number FROM _purge_dc);
DELETE FROM sm_courier_details WHERE dc_number IN (SELECT dc_number FROM _purge_dc);

DELETE FROM dc_qc_tickets
 WHERE dc_number IN (SELECT dc_number FROM _purge_dc)
    OR sales_order_number IN (SELECT sales_order_number FROM _purge_so);

DELETE FROM inventory_status_transitions
 WHERE dc_number IN (SELECT dc_number FROM _purge_dc);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customer_inventory') THEN
    EXECUTE $q$
      DELETE FROM customer_inventory
       WHERE dc_number IN (SELECT dc_number FROM _purge_dc)
    $q$;
  END IF;
END $$;

-- Release laptops deployed on these DCs / SOs
UPDATE vendor_serial_numbers vsn
   SET inventory_status = CASE
         WHEN vsn.inventory_status IN ('live', 'sold', 'on_demo', 'delivered', 'deployed', 'in_transit', 'out_for_delivery')
           THEN 'in_stock'
         ELSE vsn.inventory_status
       END,
       current_customer_id = NULL,
       current_dc_number = NULL,
       current_entity = NULL,
       dispatch_mode = NULL,
       dispatched_at = NULL,
       delivered_at = NULL,
       returned_at = NULL,
       rent_start_date = NULL,
       rent_end_date = NULL,
       rent_monthly_rate = NULL,
       status_changed_at = NOW(),
       updated_at = NOW()
 WHERE vsn.deleted_at IS NULL
   AND vsn.serial_id IN (SELECT serial_id FROM _purge_serials);

-- SO serial allocations: remove for deleted SOs; detach for DC-only purge
DELETE FROM sales_order_serials
 WHERE sales_order_number IN (SELECT sales_order_number FROM _purge_so);

UPDATE sales_order_serials sos
   SET dc_number = NULL,
       status = 'attached',
       updated_at = NOW()
 WHERE sos.dc_number IN (SELECT dc_number FROM _purge_dc)
   AND sos.sales_order_number NOT IN (SELECT sales_order_number FROM _purge_so);

-- Delivery challans (Delivery Register + Delivery Challans list)
DELETE FROM delivery_challan_lines
 WHERE dc_number IN (SELECT dc_number FROM _purge_dc)
    OR sales_order_number IN (SELECT sales_order_number FROM _purge_so);

-- Sales order lines (removes SO from Sales Orders list)
DELETE FROM sales_order_lines
 WHERE sales_order_number IN (SELECT sales_order_number FROM _purge_so);

-- Pre-dispatch QC tickets created for these SOs (child rows first)
DO $$
DECLARE
  tbl TEXT;
  ticket_tables TEXT[] := ARRAY[
    'qc_photos', 'diagnosis_images', 'diagnosis_parts_required', 'ticket_part_blocks',
    'activities', 'work_logs', 'ticket_parts', 'photos', 'ticket_services',
    'ticket_checklist_progress', 'chip_level_repairs', 'qc_results', 'diagnosis_results',
    'part_requests', 'ttspl_config_history'
  ];
BEGIN
  FOREACH tbl IN ARRAY ticket_tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = tbl
    ) AND EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = tbl AND column_name = 'ticket_id'
    ) THEN
      EXECUTE format(
        'DELETE FROM %I WHERE ticket_id IN (SELECT ticket_id FROM _purge_tickets)',
        tbl
      );
    END IF;
  END LOOP;
END $$;

DELETE FROM tickets
 WHERE ticket_id IN (SELECT ticket_id FROM _purge_tickets);

DO $$
DECLARE
  n_so INT;
  n_dc INT;
  n_dcl INT;
  n_sol INT;
  n_serial INT;
BEGIN
  SELECT COUNT(*) INTO n_so FROM _purge_so;
  SELECT COUNT(*) INTO n_dc FROM _purge_dc;
  SELECT COUNT(*) INTO n_dcl FROM delivery_challan_lines dcl
    WHERE dcl.dc_number IN (SELECT dc_number FROM _purge_dc)
       OR dcl.sales_order_number IN (SELECT sales_order_number FROM _purge_so);
  SELECT COUNT(*) INTO n_sol FROM sales_order_lines sol
    WHERE sol.sales_order_number IN (SELECT sales_order_number FROM _purge_so);
  SELECT COUNT(*) INTO n_serial FROM _purge_serials;
  RAISE NOTICE '109_remove_test_so_dc_records: purge SO=%, DC=%, remaining dcl=%, remaining sol=%, serials reset=%',
    n_so, n_dc, n_dcl, n_sol, n_serial;
END $$;

INSERT INTO schema_migrations (name)
VALUES ('109_remove_test_so_dc_records.sql')
ON CONFLICT (name) DO NOTHING;

COMMIT;
