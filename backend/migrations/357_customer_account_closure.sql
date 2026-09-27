-- 357: closing a customer account (claude/carret-customers-returns-control.md, SD1).
-- The security deposit is refunded only here — never when a laptop comes back.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by INTEGER,
  ADD COLUMN IF NOT EXISTS close_note TEXT;
