-- 408: Trade name on the lead.
--
-- A GSTIN looked up on a lead now fills the company's legal name, trade name,
-- company type, PAN and billing address on the lead, so the Deal / Demo
-- conversion starts from them instead of the salesperson typing them again.
-- Every other field already had a column (company_name, company_type,
-- pan_number, billing_address, city, state, pincode); trade name did not.
-- Additive only.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS trade_name VARCHAR(255);
