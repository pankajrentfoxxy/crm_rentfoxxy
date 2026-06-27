-- ============================================================
-- Migration 111: Fill SO/26-27/0780 gap — renumber 0781→0780, 0782→0781
-- Next sales order after this migration: SO/26-27/0782
-- Idempotent: skips when already renumbered.
-- ============================================================

CREATE OR REPLACE FUNCTION _m111_rename_so(old_so TEXT, new_so TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  tbl RECORD;
  old_slug TEXT;
  new_slug TEXT;
BEGIN
  old_slug := regexp_replace(old_so, '[^a-zA-Z0-9-]', '_', 'g');
  new_slug := regexp_replace(new_so, '[^a-zA-Z0-9-]', '_', 'g');

  FOR tbl IN
    SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema
       AND t.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND c.column_name = 'sales_order_number'
       AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format(
      'UPDATE %I SET sales_order_number = $1 WHERE sales_order_number = $2',
      tbl.table_name
    ) USING new_so, old_so;
  END LOOP;

  FOR tbl IN
    SELECT c.table_name, c.column_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema
       AND t.table_name = c.table_name
     WHERE c.table_schema = 'public'
       AND c.column_name IN ('pdf_path', 'file_path')
       AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format(
      'UPDATE %I
          SET %I = REPLACE(REPLACE(%I, $1, $2), $3, $4)
        WHERE %I IS NOT NULL
          AND (%I LIKE $5 OR %I LIKE $6)',
      tbl.table_name,
      tbl.column_name,
      tbl.column_name,
      tbl.column_name,
      tbl.column_name,
      tbl.column_name
    ) USING old_so, new_so, old_slug, new_slug, '%' || old_so || '%', '%' || old_slug || '%';
  END LOOP;
END;
$$;

BEGIN;

DO $$
DECLARE
  fy_label TEXT := '26-27';
  so_old_1 TEXT := 'SO/' || fy_label || '/0781';
  so_old_2 TEXT := 'SO/' || fy_label || '/0782';
  so_new_1 TEXT := 'SO/' || fy_label || '/0780';
  so_new_2 TEXT := 'SO/' || fy_label || '/0781';
  so_tmp_2 TEXT := 'SO/' || fy_label || '/__M111_0782__';
  has_781 BOOLEAN;
  has_782 BOOLEAN;
  has_780 BOOLEAN;
BEGIN
  SELECT EXISTS (SELECT 1 FROM sales_order_lines WHERE sales_order_number = so_old_1) INTO has_781;
  SELECT EXISTS (SELECT 1 FROM sales_order_lines WHERE sales_order_number = so_old_2) INTO has_782;
  SELECT EXISTS (SELECT 1 FROM sales_order_lines WHERE sales_order_number = so_new_1) INTO has_780;

  IF has_780 AND NOT has_781 AND NOT has_782 THEN
    RAISE NOTICE '111: already applied — % exists, %/% absent', so_new_1, so_old_1, so_old_2;
    RETURN;
  END IF;

  IF NOT has_781 OR NOT has_782 THEN
    RAISE EXCEPTION '111: expected both % and % in sales_order_lines (found 781=%, 782=%)',
      so_old_1, so_old_2, has_781, has_782;
  END IF;

  IF has_780 THEN
    RAISE EXCEPTION '111: % already exists — resolve manually before re-running', so_new_1;
  END IF;

  PERFORM _m111_rename_so(so_old_2, so_tmp_2);
  PERFORM _m111_rename_so(so_old_1, so_new_1);
  PERFORM _m111_rename_so(so_tmp_2, so_new_2);

  INSERT INTO sm_document_sequences (doc_type, last_value, prefix)
  VALUES ('so_rentfoxxy', 26270000 + 781, 'SO-')
  ON CONFLICT (doc_type) DO UPDATE
     SET last_value = EXCLUDED.last_value, updated_at = NOW();

  RAISE NOTICE '111: renumbered %→%, %→%; next SO=%/0782',
    so_old_1, so_new_1, so_old_2, so_new_2, 'SO/' || fy_label;
END $$;

INSERT INTO schema_migrations (name)
VALUES ('111_renumber_so_fill_0780_gap.sql')
ON CONFLICT (name) DO NOTHING;

COMMIT;

DROP FUNCTION IF EXISTS _m111_rename_so(TEXT, TEXT);
