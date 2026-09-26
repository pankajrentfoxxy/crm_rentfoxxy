-- Support charges (claude/carret-support.md, user's rules 26 Sep 2026).
-- Parts are free by default (the service is ours). A part is charged only when
-- Support marks the request chargeable (with a reason); the WAREHOUSE sets its
-- price. A priced, chargeable part that was used / delivered becomes an
-- approved line in customer_invoice_extra_lines, which Accounts adds to the
-- customer's draft invoice.
ALTER TABLE support_part_requests
  ADD COLUMN IF NOT EXISTS charge_reason TEXT,
  ADD COLUMN IF NOT EXISTS charge_marked_by INTEGER,
  ADD COLUMN IF NOT EXISTS charge_marked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS charge_priced_by INTEGER,
  ADD COLUMN IF NOT EXISTS charge_priced_at TIMESTAMPTZ;

-- One charge line per part request.
CREATE UNIQUE INDEX IF NOT EXISTS customer_invoice_extra_lines_part_uq
  ON customer_invoice_extra_lines (source_part_request_id) WHERE source_part_request_id IS NOT NULL;

-- Work-from-home laptops: a return pickup or a replacement delivery to an
-- employee's home is chargeable (Rs 799 + GST) when Support clicks "charge".
-- The amount goes on that DC's shiping_charges, which the Delivery Charges page
-- reads; these columns record the decision on the support laptop row.
ALTER TABLE support_ticket_items
  ADD COLUMN IF NOT EXISTS wfh_charge BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS wfh_charge_amount NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS wfh_charge_dc_number VARCHAR(60),
  ADD COLUMN IF NOT EXISTS wfh_charge_by INTEGER,
  ADD COLUMN IF NOT EXISTS wfh_charge_at TIMESTAMPTZ;
