-- 410: Praman proof on Dispatch QC.
--
-- Before a laptop passes Dispatch QC the tester records the Praman Device ID
-- and attaches the Praman report (PDF), so the sales order keeps proof that the
-- device was Praman-verified and tested before dispatch. One row per Dispatch
-- QC ticket (a re-upload replaces it); the PDF lives under
-- backend/private-uploads/praman/ and is served only through an authenticated
-- route. qcController.submitQC and the admin Dispatch QC -> Inventory move
-- refuse a pass without it. Additive only.

CREATE TABLE IF NOT EXISTS dispatch_qc_praman (
  praman_id      SERIAL PRIMARY KEY,
  ticket_id      INT NOT NULL UNIQUE,
  device_id      VARCHAR(100) NOT NULL,
  report_path    TEXT NOT NULL,
  report_name    TEXT,
  uploaded_by    INT,
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
