-- Procure to stock, D13: spare-parts POs follow the laptop PO flow — rejection
-- with a reason, cancel (a status with a reason, not a silent soft delete),
-- short-close and amend, each with who, when and why.
ALTER TABLE vendor_spare_parts_purchase_orders
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS amendment_no INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS amended_by INT REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS amend_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by INT REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by INT REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS close_reason TEXT;
