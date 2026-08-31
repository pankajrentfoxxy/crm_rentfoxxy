-- Persist per-vendor exclusion from Vendor Master Data / Vendor PO rollups.
-- Does not delete vendors or change laptop inventory.

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS exclude_from_vendor_po BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_vendors_exclude_from_vendor_po
  ON vendors (exclude_from_vendor_po)
  WHERE deleted_at IS NULL AND exclude_from_vendor_po = TRUE;
