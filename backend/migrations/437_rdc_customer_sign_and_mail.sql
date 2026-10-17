-- 437: Return DC — the customer's signature and the mail to the customer (17 Oct 2026).
--
-- A technician collects every laptop on a Return DC with one customer OTP.
-- The customer signs (or a photo of the signed paper is the proof), and the
-- signed Return DC is mailed to the customer — a required step: the pickup
-- stays on the technician's list until it has been sent (or the send was
-- attempted and recorded when mail is turned off). Additive only.

ALTER TABLE delivery_challan_lines ADD COLUMN IF NOT EXISTS customer_esign_url TEXT;
ALTER TABLE delivery_challan_lines ADD COLUMN IF NOT EXISTS customer_signer_name TEXT;
ALTER TABLE delivery_challan_lines ADD COLUMN IF NOT EXISTS customer_signed_at TIMESTAMPTZ;
ALTER TABLE delivery_challan_lines ADD COLUMN IF NOT EXISTS customer_mail_to TEXT;
ALTER TABLE delivery_challan_lines ADD COLUMN IF NOT EXISTS customer_mail_sent_at TIMESTAMPTZ;
ALTER TABLE delivery_challan_lines ADD COLUMN IF NOT EXISTS customer_mail_attempted_at TIMESTAMPTZ;
ALTER TABLE delivery_challan_lines ADD COLUMN IF NOT EXISTS customer_mail_error TEXT;
