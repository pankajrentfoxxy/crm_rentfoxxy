-- Per-line HSN/SAC on Sales Orders and Delivery Challans (incl. Return DCs).
-- Defaults are assigned by transaction type via constants/hsnDefaults.js (not companies.hsn_code).

ALTER TABLE sales_order_lines
  ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(12);

ALTER TABLE delivery_challan_lines
  ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(12);

COMMENT ON COLUMN sales_order_lines.hsn_code IS 'HSN/SAC — rental 997315, sale 847130; admin override allowed';
COMMENT ON COLUMN delivery_challan_lines.hsn_code IS 'HSN/SAC inherited from SO or resolved from quotation_type / repair context';
