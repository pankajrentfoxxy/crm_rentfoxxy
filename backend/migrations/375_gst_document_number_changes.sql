-- 375: GST document numbers — audit of every attach / replace (decision MD7, 29 Sep 2026).
--
-- Accounts attach three kinds of number that come from outside the CRM:
--   * the Zoho / e-invoice number on a customer delivery challan
--     (delivery_challan_lines.einvoice_number),
--   * the e-way bill number on a delivery challan (…eway_bill_number),
--   * the Zoho invoice number on a sale-in-place sales order
--     (sales_order_lines.sale_invoice_number).
-- Until now a second upload silently overwrote the first. The handlers now
-- refuse a different number unless the caller asks to replace it and gives a
-- reason; each attach and replace is recorded here with the old value.
--
-- Additive and idempotent: one new table, three expression indexes for the
-- duplicate-number lookup. Nothing existing is altered or overwritten.

CREATE TABLE IF NOT EXISTS gst_document_number_changes (
  id          BIGSERIAL PRIMARY KEY,
  doc_type    VARCHAR(32)  NOT NULL,   -- delivery_challan | sales_order
  doc_number  VARCHAR(64)  NOT NULL,
  field       VARCHAR(32)  NOT NULL,   -- einvoice_number | eway_bill_number | sale_invoice_number
  action      VARCHAR(16)  NOT NULL,   -- attach | replace
  old_value   TEXT,
  new_value   TEXT,
  reason      TEXT,
  changed_by  INTEGER,
  changed_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gst_document_number_changes_action_check'
  ) THEN
    ALTER TABLE gst_document_number_changes
      ADD CONSTRAINT gst_document_number_changes_action_check
      CHECK (action IN ('attach', 'replace'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'gst_document_number_changes_replace_reason_check'
  ) THEN
    ALTER TABLE gst_document_number_changes
      ADD CONSTRAINT gst_document_number_changes_replace_reason_check
      CHECK (action <> 'replace' OR length(trim(COALESCE(reason, ''))) > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_gst_doc_number_changes_doc
  ON gst_document_number_changes (doc_type, doc_number, changed_at DESC);

-- Duplicate-number lookups compare trimmed, upper-cased values.
CREATE INDEX IF NOT EXISTS idx_dcl_einvoice_number_norm
  ON delivery_challan_lines (UPPER(TRIM(einvoice_number)))
  WHERE einvoice_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dcl_eway_bill_number_norm
  ON delivery_challan_lines (UPPER(TRIM(eway_bill_number)))
  WHERE eway_bill_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sol_sale_invoice_number_norm
  ON sales_order_lines (UPPER(TRIM(sale_invoice_number)))
  WHERE sale_invoice_number IS NOT NULL;
