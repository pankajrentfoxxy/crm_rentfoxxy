-- Sales QC checklist audit + timestamp (run on deploy DB)
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS qc_sales_checklist JSONB;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS qc_sales_passed_at TIMESTAMPTZ;
