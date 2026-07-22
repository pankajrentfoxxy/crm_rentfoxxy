-- 150_widen_qc_results_processor.sql
-- Hardware script / PA config sends full CPU strings (e.g. "11th Gen Intel(R) Core(TM) i5-1145G7 @ 2.60GHz")
-- which exceed the legacy VARCHAR(20) meant for short labels like i5.

ALTER TABLE qc_results
  ALTER COLUMN processor TYPE VARCHAR(255),
  ALTER COLUMN generation TYPE VARCHAR(50),
  ALTER COLUMN ram_size TYPE VARCHAR(50),
  ALTER COLUMN storage_type TYPE VARCHAR(100);
