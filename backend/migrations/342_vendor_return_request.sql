-- Vendor return request (D10, claude/carret-vendor-return-request.md).
-- A rental return now carries the date rent stops (chosen by the user, today or
-- later) and the pickup slot offered to the vendor; the request PDF and the
-- addresses the mail went to are kept. Cancelling after the vendor was told is
-- recorded, because it resumes rent and mails the vendor.
-- Return challans get the carrier's name and phone for Porter and In-house, and
-- a record of the automatic e-way request to Accounts. Additive only.
ALTER TABLE vendor_return_tickets
  ADD COLUMN IF NOT EXISTS rent_stop_date DATE,
  ADD COLUMN IF NOT EXISTS pickup_date DATE,
  ADD COLUMN IF NOT EXISTS pickup_time VARCHAR(20),
  ADD COLUMN IF NOT EXISTS reason_code VARCHAR(40),
  ADD COLUMN IF NOT EXISTS request_pdf_path TEXT,
  ADD COLUMN IF NOT EXISTS notify_to TEXT,
  ADD COLUMN IF NOT EXISTS notify_cc TEXT,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
  ADD COLUMN IF NOT EXISTS cancel_mail_sent_at TIMESTAMPTZ;

ALTER TABLE vendor_return_delivery_challans
  ADD COLUMN IF NOT EXISTS porter_person_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS porter_person_phone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS delivery_person_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS delivery_person_phone VARCHAR(20),
  ADD COLUMN IF NOT EXISTS eway_auto_mail_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS eway_auto_mail_error TEXT;
