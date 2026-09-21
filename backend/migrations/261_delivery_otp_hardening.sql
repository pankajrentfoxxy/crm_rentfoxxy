-- Part 3.4 (finding V6) — harden the delivery OTP.
--
-- What it is today: six digits, stored in PLAINTEXT, compared as a bare string
-- with unlimited retries, no expiry, and written to EVERY LINE of the challan
-- so one code opens all of them. A six-digit code with unlimited attempts is
-- not a second factor; it is a speed bump worth about 500,000 guesses.
--
-- This migration adds the columns. The enforcement lives in
-- services/deliveryOtpService.js, because a constraint cannot express "five
-- attempts then re-issue".
--
-- WHAT IS NOT DONE HERE: the old plaintext columns are NOT dropped. Finding V7
-- is that three OTP column families coexist — otp_code, d_otp, and
-- delivery_otp — and different screens read different ones. Dropping any of
-- them before every reader is moved would break a delivery in progress.
-- Retiring them is a separate, announced change once the new path has run for
-- a release.

ALTER TABLE public.delivery_challan_lines
  -- The hash, not the code. Salted per row by including the dc_number in the
  -- digest, so the same six digits on two challans do not share a hash.
  ADD COLUMN IF NOT EXISTS otp_hash TEXT,

  -- Fifteen minutes, per the plan. An OTP with no expiry stays valid until the
  -- row is deleted, which in practice means forever.
  ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMPTZ,

  -- Five, then re-issue. Unlimited retries on six digits is the whole exposure.
  ADD COLUMN IF NOT EXISTS otp_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS otp_last_attempt_at TIMESTAMPTZ,

  -- Scope. The code is issued for the CHALLAN; every line of that challan
  -- carries the same issue id so verifying once verifies the consignment,
  -- rather than one code independently opening each line.
  ADD COLUMN IF NOT EXISTS otp_issue_id UUID;

CREATE INDEX IF NOT EXISTS idx_dcl_otp_issue
  ON public.delivery_challan_lines (otp_issue_id)
  WHERE otp_issue_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- In-flight OTPs.
--
-- 193 lines carry a code and 5 of them are still unverified. Those five are
-- real deliveries someone may be standing in front of right now, so they are
-- given a fresh 15-minute window rather than being invalidated — but the
-- plaintext is NOT copied into otp_hash, because the hash needs the service's
-- salt and a migration should not reimplement it.
--
-- The practical effect: those five re-issue on next use, which is a normal
-- action the driver already has a button for. Verified rows need nothing.
-- ---------------------------------------------------------------------------
UPDATE public.delivery_challan_lines
   SET otp_expires_at = NOW() + INTERVAL '15 minutes'
 WHERE otp_code IS NOT NULL
   AND otp_verified_at IS NULL
   AND otp_expires_at IS NULL;

COMMENT ON COLUMN public.delivery_challan_lines.otp_hash IS
  'Part 3.4 / V6. HMAC of the delivery OTP, salted with the dc_number. The '
  'plaintext otp_code / d_otp / delivery_otp columns are legacy and still read '
  'by older screens; they are retired separately once every reader has moved.';

COMMENT ON COLUMN public.delivery_challan_lines.otp_issue_id IS
  'One issue per CHALLAN. Every line of a challan shares it, so a code opens '
  'the consignment rather than each line independently (V6).';
