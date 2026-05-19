-- When an order first becomes QC Pending (procurement assign, warehouse ready, etc.)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS qc_received_at TIMESTAMPTZ;
-- When all sales QC is done (order becomes QC Passed)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS qc_completed_at TIMESTAMPTZ;
