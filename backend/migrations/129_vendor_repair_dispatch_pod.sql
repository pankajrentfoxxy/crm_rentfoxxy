-- Optional dispatch POD photo on vendor repair DC

ALTER TABLE vendor_repair_delivery_challans
  ADD COLUMN IF NOT EXISTS dispatch_pod_path TEXT;
