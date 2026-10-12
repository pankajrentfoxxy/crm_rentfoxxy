-- qc_results_history must hold whatever qc_results holds; narrower columns made the
-- history snapshot fail (e.g. ram_size "32GB Ram + 4GB Graphic Card" > 20 chars),
-- which aborted the whole QC submit transaction.
ALTER TABLE qc_results_history ALTER COLUMN processor TYPE VARCHAR(255);
ALTER TABLE qc_results_history ALTER COLUMN storage_type TYPE VARCHAR(100);
ALTER TABLE qc_results_history ALTER COLUMN ram_size TYPE VARCHAR(50);
