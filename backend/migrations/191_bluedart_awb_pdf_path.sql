-- Migration: 191_bluedart_awb_pdf_path.sql
-- Store BlueDart waybill label PDF path on delivery challan lines.

ALTER TABLE delivery_challan_lines
  ADD COLUMN IF NOT EXISTS bluedart_awb_pdf_path TEXT;

COMMENT ON COLUMN delivery_challan_lines.bluedart_awb_pdf_path IS
  'Relative path to BlueDart GenerateWayBill AWBPrintContent PDF (uploads/bluedart/...)';
