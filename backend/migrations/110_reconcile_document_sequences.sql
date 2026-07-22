-- ============================================================
-- Migration 110: Reconcile SO/DC/RDC/support sequences from data
-- Run after 109 (or standalone) so next numbers continue from last used.
-- Idempotent: safe to re-run.
-- ============================================================

BEGIN;

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

  RAISE NOTICE '110 sequence reconcile FY=%: max SO seq=%, next SO=%; max DC seq=%, next DC=%; max RDC=%; max support ticket id=%',
    fy_label, max_so, next_so, max_dc, next_dc, max_rdc, max_support;
END $$;

INSERT INTO schema_migrations (name)
VALUES ('110_reconcile_document_sequences.sql')
ON CONFLICT (name) DO NOTHING;

COMMIT;
