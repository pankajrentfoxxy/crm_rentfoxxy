-- 429: Praman report uploaded from the tested laptop (16 Oct 2026).
--
-- The Praman PDF is produced on the laptop under test. The Dispatch QC
-- hardware-verification page (opened on that laptop) now takes the PDF
-- straight after the configuration matches, so nobody copies it to another
-- machine. That row has the report but no Device ID yet; the inspector types
-- only the Device ID on Dispatch QC. A pass still needs both
-- (dispatchQcPramanService.assertPramanForPass). Additive only.

ALTER TABLE dispatch_qc_praman ALTER COLUMN device_id DROP NOT NULL;
ALTER TABLE dispatch_qc_praman ADD COLUMN IF NOT EXISTS report_source VARCHAR(20) NOT NULL DEFAULT 'crm';
ALTER TABLE dispatch_qc_praman ADD COLUMN IF NOT EXISTS report_uploaded_at TIMESTAMPTZ;
