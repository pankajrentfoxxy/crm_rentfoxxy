-- Part 6.2 (finding BL7) — GST is a flat hardcoded 18% with no place of supply,
-- no CGST/SGST versus IGST split, and no columns to hold one.
--
-- Every inter-state supply on this system is therefore mis-classified. The
-- invoice says "GST 18%" where it should say IGST 18%, or CGST 9% + SGST 9%, and
-- the difference is not cosmetic — it decides which government is paid and
-- whether the customer can claim the credit.
--
-- services/salesManagementService.js already knows how to do this
-- (computeGstBreakdown / isIntraState, driven by the place of supply). It has
-- known since the sales documents were built. Billing just never asked it.
-- These columns are what it needs to write its answer into.
--
-- gst_amount stays as the total, so every existing reader keeps working and the
-- three new columns sum to it.

ALTER TABLE customer_invoices
  ADD COLUMN IF NOT EXISTS cgst_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS place_of_supply  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS is_intra_state   BOOLEAN;

ALTER TABLE vendor_monthly_bills
  ADD COLUMN IF NOT EXISTS cgst_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS place_of_supply  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS is_intra_state   BOOLEAN;

-- Existing rows are NOT back-classified. is_intra_state stays NULL, which reads
-- as "nobody worked this out" rather than asserting a split that was never
-- computed. Rule 5: a migration must not invent a fact it cannot reconstruct,
-- and the place of supply for a 2024 invoice is not recoverable from a total.
COMMENT ON COLUMN customer_invoices.is_intra_state IS
  'NULL = raised before the CGST/SGST vs IGST split existed (Part 6.2, BL7). Not back-classified.';
