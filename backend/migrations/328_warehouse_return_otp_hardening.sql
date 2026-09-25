-- 328: harden the warehouse-return OTP the way 261 hardened the delivery OTP.
--
-- A refused delivery comes back to the warehouse against a code sent to the
-- warehouse lead. It was stored in plaintext with no expiry and no attempt
-- limit. From here only an HMAC is stored, it expires, and five wrong tries
-- lock it until a new code is sent.
--
-- Additive only. The plaintext column stays (nullable) and is cleared when a
-- new code is issued; nothing reads it for verification any more.
ALTER TABLE delivery_challan_lines
  ADD COLUMN IF NOT EXISTS warehouse_return_otp_hash TEXT,
  ADD COLUMN IF NOT EXISTS warehouse_return_otp_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS warehouse_return_otp_attempts INTEGER NOT NULL DEFAULT 0;
