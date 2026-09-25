-- E-way Bill on the Return to Vendor DC (VRTDC).
--
-- VRTDC is the one outbound consignment in the system with no e-way support at
-- all. The Out-for-Repair DC (VRDC) and the demo/sale DC both carry an e-way
-- bill, enforce the Rs 50,000 threshold and lock the PDF until Accounts fills it
-- in. VRTDC has neither the columns nor a declared value to measure against, so
-- a return of any size dispatches with nothing — and a laptop return is
-- routinely well above the threshold.
--
-- Mirrors vendor_repair_delivery_challans so vrtdcEwayComplianceService can be a
-- straight port of vrdcEwayComplianceService rather than a second dialect.
--
-- declared_value lives on the ITEM, not the header: an e-way bill is per
-- consignment but the value has to be defended per laptop, and the VRDC flow
-- already asks the dispatcher for a price per unit. The header total is always
-- SUM(items.declared_value), never stored twice.
--
-- Additive and idempotent. Every existing VRTDC keeps working — a DC with no
-- declared values totals zero, which is below the threshold, so nothing that is
-- already dispatched suddenly becomes non-compliant.

ALTER TABLE public.vendor_return_delivery_challans
  ADD COLUMN IF NOT EXISTS eway_bill_number      VARCHAR(32),
  ADD COLUMN IF NOT EXISTS eway_bill_date        DATE,
  ADD COLUMN IF NOT EXISTS eway_bill_pdf_path    TEXT,
  ADD COLUMN IF NOT EXISTS eway_bill_uploaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS eway_bill_uploaded_by INTEGER,
  ADD COLUMN IF NOT EXISTS accounts_notified_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accounts_notified_by  INTEGER;

ALTER TABLE public.vendor_return_dc_items
  ADD COLUMN IF NOT EXISTS declared_value NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS hsn_code       VARCHAR(16);

-- A declared value is a price: never negative. NOT VALID so the constraint
-- applies to new and updated rows without scanning history that predates it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.vendor_return_dc_items'::regclass
       AND conname = 'vendor_return_dc_items_declared_value_non_negative'
  ) THEN
    ALTER TABLE public.vendor_return_dc_items
      ADD CONSTRAINT vendor_return_dc_items_declared_value_non_negative
      CHECK (declared_value IS NULL OR declared_value >= 0) NOT VALID;
  END IF;
END $$;

-- Accounts works a queue of "sent for e-way, nothing uploaded yet".
CREATE INDEX IF NOT EXISTS idx_vrtdc_eway_pending
  ON public.vendor_return_delivery_challans (accounts_notified_at)
  WHERE accounts_notified_at IS NOT NULL
    AND COALESCE(eway_bill_number, '') = '';

COMMENT ON COLUMN public.vendor_return_dc_items.declared_value IS
  'Consignment value for this laptop, entered at dispatch. SUM over the DC is '
  'what the Rs 50,000 e-way threshold is measured against.';
