-- 215: VRDC E-way Bill accounts workflow (notify + upload metadata)
ALTER TABLE vendor_repair_delivery_challans
  ADD COLUMN IF NOT EXISTS accounts_notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accounts_notified_by INTEGER REFERENCES users(user_id),
  ADD COLUMN IF NOT EXISTS eway_bill_uploaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS eway_bill_uploaded_by INTEGER REFERENCES users(user_id);

CREATE INDEX IF NOT EXISTS idx_vrdc_accounts_notified
  ON vendor_repair_delivery_challans (accounts_notified_at)
  WHERE accounts_notified_at IS NOT NULL;
