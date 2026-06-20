-- ============================================================
-- Migration: 095_qc_stage_dispatch.sql
-- Allow QC results to be recorded for the "Dispatch QC" stage (pre-dispatch QC
-- for sales_order_qc tickets). Previously qc_results.qc_stage only allowed
-- QC1/QC2, so submitting a Dispatch QC pass/fail failed.
-- ============================================================
-- "Dispatch QC" is 11 chars; the column was varchar(10).
ALTER TABLE qc_results ALTER COLUMN qc_stage TYPE VARCHAR(20);
ALTER TABLE qc_results DROP CONSTRAINT IF EXISTS qc_results_qc_stage_check;
ALTER TABLE qc_results ADD CONSTRAINT qc_results_qc_stage_check
  CHECK (qc_stage IN ('QC1', 'QC2', 'Dispatch QC'));
