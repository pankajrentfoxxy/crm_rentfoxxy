-- 330: somewhere to keep a vendor's GST certificate.
--
-- The vendor form has always had a "GST Certificate" upload; the file was sent
-- under a field multer did not accept (400 "Unexpected field") and there was no
-- column for it. Additive: one nullable column.
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS gst_certificate_url TEXT;
