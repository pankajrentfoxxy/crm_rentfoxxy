-- ============================================================
-- Migration 216: Support v2 part pricing + fault attribution
--   (D5, D6). Selling price lives on the parts master.
--   Chargeability is decided by fault attribution.
-- Idempotent.
-- ============================================================

ALTER TABLE parts
  ADD COLUMN IF NOT EXISTS selling_price NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS gst_rate NUMERIC(5,2) DEFAULT 18,
  ADD COLUMN IF NOT EXISTS price_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS price_updated_by INT REFERENCES users(user_id);

ALTER TABLE part_requests
  ADD COLUMN IF NOT EXISTS fault_attribution VARCHAR(30),
  ADD COLUMN IF NOT EXISTS unit_selling_price NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS price_override_reason TEXT,
  ADD COLUMN IF NOT EXISTS approval_id INT REFERENCES support_approvals(approval_id),
  ADD COLUMN IF NOT EXISTS needs_lead_approval BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS requested_before_visit BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE part_requests DROP CONSTRAINT IF EXISTS part_requests_fault_attr_check;
ALTER TABLE part_requests ADD CONSTRAINT part_requests_fault_attr_check
  CHECK (fault_attribution IS NULL OR fault_attribution IN
    ('COMPANY_FAULT', 'WEAR_AND_TEAR', 'CUSTOMER_DAMAGE', 'CUSTOMER_BREAKAGE', 'VENDOR_WARRANTY', 'UNKNOWN'));

UPDATE part_requests SET fault_attribution = CASE liability
  WHEN 'CUSTOMER_CHARGEABLE' THEN 'CUSTOMER_DAMAGE'
  WHEN 'VENDOR_WARRANTY'     THEN 'VENDOR_WARRANTY'
  WHEN 'COMPANY'             THEN 'COMPANY_FAULT'
  ELSE 'UNKNOWN' END
WHERE fault_attribution IS NULL;

UPDATE part_requests
   SET needs_lead_approval = TRUE
 WHERE fault_attribution IN ('CUSTOMER_DAMAGE', 'CUSTOMER_BREAKAGE', 'UNKNOWN')
   AND needs_lead_approval = FALSE;
