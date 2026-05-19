-- Columns referenced by GET /sales/qc-pipeline-orders and per-item QC (older DBs may lack them)
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS qc_passed BOOLEAN DEFAULT false;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;

-- order_status_history: logOrderStatusHistory INSERT does not set time; queries use changed_at
ALTER TABLE order_status_history ADD COLUMN IF NOT EXISTS changed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
