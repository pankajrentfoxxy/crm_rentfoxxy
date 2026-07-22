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

-- Return DC (RDC…) rows tied to purged outbound SO/DC
INSERT INTO _purge_dc (dc_number)
SELECT DISTINCT dcl.dc_number
  FROM delivery_challan_lines dcl
 WHERE dcl.movement_type = 'return'
   AND (
     dcl.original_dc_number IN (SELECT dc_number FROM _purge_dc)
     OR dcl.sales_order_number IN (SELECT sales_order_number FROM _purge_so)
   )
ON CONFLICT DO NOTHING;

CREATE TEMP TABLE _purge_support (ticket_id INT PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _purge_support (ticket_id)
SELECT DISTINCT ticket_id FROM (
  SELECT t.id AS ticket_id
    FROM support_tickets t
   WHERE t.sales_order_number IN (SELECT sales_order_number FROM _purge_so)
      OR t.dc_number IN (SELECT dc_number FROM _purge_dc)
      OR t.return_dc_number IN (SELECT dc_number FROM _purge_dc)
  UNION
  SELECT sti.ticket_id
    FROM support_ticket_items sti
   WHERE sti.return_dc_number IN (SELECT dc_number FROM _purge_dc)
) x
WHERE ticket_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO _purge_dc (dc_number)
SELECT DISTINCT dc_ref FROM (
  SELECT sti.return_dc_number AS dc_ref
    FROM _purge_support ps
    JOIN support_ticket_items sti ON sti.ticket_id = ps.ticket_id
   WHERE sti.return_dc_number IS NOT NULL
  UNION
  SELECT dcl.dc_number
    FROM _purge_support ps
    JOIN delivery_challan_lines dcl ON dcl.support_ticket_id = ps.ticket_id
   WHERE dcl.movement_type = 'return'
) y
WHERE dc_ref IS NOT NULL AND TRIM(dc_ref) <> ''
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

-- Support tickets linked to purged SO/DC/return DC (items cascade on delete)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'support_part_challans') THEN
    EXECUTE $q$
      DELETE FROM support_part_challans
       WHERE support_ticket_id IN (SELECT ticket_id FROM _purge_support)
    $q$;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'support_part_requests') THEN
    EXECUTE $q$
      DELETE FROM support_part_requests
       WHERE support_ticket_id IN (SELECT ticket_id FROM _purge_support)
    $q$;
  END IF;
END $$;

DELETE FROM support_replacement_orders
 WHERE ticket_id IN (SELECT ticket_id FROM _purge_support);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'support_ticket_items'
       AND column_name = 'reassign_to_ticket_id'
  ) THEN
    EXECUTE $q$
      UPDATE support_ticket_items
         SET reassign_to_ticket_id = NULL,
             reassign_to_item_id = NULL
       WHERE reassign_to_ticket_id IN (SELECT ticket_id FROM _purge_support)
    $q$;
  END IF;
END $$;

DELETE FROM support_tickets
 WHERE id IN (SELECT ticket_id FROM _purge_support);

-- Reconcile document sequences so the next issued number continues from the last used.
DO $$
DECLARE
  fy_start INT;
  fy_code INT;
  fy_label TEXT;
  a TEXT;
  b TEXT;
  max_so INT;
  max_dc INT;
  max_rdc INT;
  max_legacy_so INT;
  max_legacy_dc INT;
  max_support INT;
  next_so TEXT;
  next_dc TEXT;
BEGIN
  fy_start := CASE
    WHEN EXTRACT(MONTH FROM CURRENT_DATE) >= 4 THEN EXTRACT(YEAR FROM CURRENT_DATE)::INT
    ELSE EXTRACT(YEAR FROM CURRENT_DATE)::INT - 1
  END;
  a := lpad((fy_start % 100)::TEXT, 2, '0');
  b := lpad(((fy_start + 1) % 100)::TEXT, 2, '0');
  fy_code := (a || b)::INT;
  fy_label := a || '-' || b;

  SELECT COALESCE(MAX((split_part(sales_order_number, '/', 3))::INT), 0)
    INTO max_so
    FROM sales_order_lines
   WHERE sales_order_number ~ ('^SO/' || fy_label || '/[0-9]+$');

  SELECT COALESCE(MAX((split_part(dc_number, '/', 3))::INT), 0)
    INTO max_dc
    FROM delivery_challan_lines
   WHERE dc_number ~ ('^DC/' || fy_label || '/[0-9]+$');

  INSERT INTO sm_document_sequences (doc_type, last_value, prefix)
  VALUES ('so_rentfoxxy', fy_code * 10000 + max_so, 'SO-')
  ON CONFLICT (doc_type) DO UPDATE
     SET last_value = EXCLUDED.last_value, updated_at = NOW();

  INSERT INTO sm_document_sequences (doc_type, last_value, prefix)
  VALUES ('dc_rentfoxxy', fy_code * 10000 + max_dc, 'DC-')
  ON CONFLICT (doc_type) DO UPDATE
     SET last_value = EXCLUDED.last_value, updated_at = NOW();

  SELECT COALESCE(MAX(num), 0) INTO max_rdc FROM (
    SELECT CASE
             WHEN dc_number ~ '^RDC[0-9]+$' THEN substring(dc_number FROM 4)::INT
             ELSE 0
           END AS num
      FROM delivery_challan_lines
     WHERE movement_type = 'return' OR dc_number ~ '^RDC[0-9]+$'
    UNION ALL
    SELECT CASE
             WHEN return_dc_number ~ '^RDC[0-9]+$' THEN substring(return_dc_number FROM 4)::INT
             ELSE 0
           END AS num
      FROM support_ticket_items
     WHERE return_dc_number IS NOT NULL
  ) rdc_nums;

  INSERT INTO sm_document_sequences (doc_type, last_value, prefix)
  VALUES ('return_dc', max_rdc, 'RDC')
  ON CONFLICT (doc_type) DO UPDATE
     SET last_value = EXCLUDED.last_value, updated_at = NOW();

  SELECT COALESCE(MAX(substring(sales_order_number FROM 4)::INT), 0)
    INTO max_legacy_so
    FROM sales_order_lines
   WHERE sales_order_number ~ '^SO-[0-9]+$';

  UPDATE sm_document_sequences
     SET last_value = max_legacy_so,
         updated_at = NOW()
   WHERE doc_type = 'sales_order';

  SELECT COALESCE(MAX(substring(dc_number FROM 4)::INT), 0)
    INTO max_legacy_dc
    FROM delivery_challan_lines
   WHERE dc_number ~ '^DC-[0-9]+$';

  UPDATE sm_document_sequences
     SET last_value = max_legacy_dc,
         updated_at = NOW()
   WHERE doc_type = 'delivery_challan';

  SELECT COALESCE(MAX(id), 0) INTO max_support FROM support_tickets;

  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'support_tickets_id_seq') THEN
    PERFORM setval('support_tickets_id_seq', GREATEST(max_support, 1));
  END IF;

  UPDATE sm_document_sequences
     SET last_value = max_support,
         updated_at = NOW()
   WHERE doc_type = 'support_ticket';

  next_so := 'SO/' || fy_label || '/' || lpad((max_so + 1)::TEXT, 4, '0');
  next_dc := 'DC/' || fy_label || '/' || lpad((max_dc + 1)::TEXT, 4, '0');

  RAISE NOTICE '109 sequence reconcile FY=%: max SO seq=%, next SO=%; max DC seq=%, next DC=%; max RDC=%; max support ticket id=%',
    fy_label, max_so, next_so, max_dc, next_dc, max_rdc, max_support;
END $$;

DO $$
DECLARE
  n_so INT;
  n_dc INT;
  n_support INT;
  n_dcl INT;
  n_sol INT;
  n_serial INT;
BEGIN
  SELECT COUNT(*) INTO n_so FROM _purge_so;
  SELECT COUNT(*) INTO n_dc FROM _purge_dc;
  SELECT COUNT(*) INTO n_support FROM _purge_support;
  SELECT COUNT(*) INTO n_dcl FROM delivery_challan_lines dcl
    WHERE dcl.dc_number IN (SELECT dc_number FROM _purge_dc)
       OR dcl.sales_order_number IN (SELECT sales_order_number FROM _purge_so);
  SELECT COUNT(*) INTO n_sol FROM sales_order_lines sol
    WHERE sol.sales_order_number IN (SELECT sales_order_number FROM _purge_so);
  SELECT COUNT(*) INTO n_serial FROM _purge_serials;
  RAISE NOTICE '109_remove_test_so_dc_records: purge SO=%, DC=%, support tickets=%, remaining dcl=%, remaining sol=%, serials reset=%',
    n_so, n_dc, n_support, n_dcl, n_sol, n_serial;
END $$;

INSERT INTO schema_migrations (name)
VALUES ('109_remove_test_so_dc_records.sql')
ON CONFLICT (name) DO NOTHING;

COMMIT;
