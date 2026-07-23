-- Password reset OTP for forgot-password flow on login page
CREATE TABLE IF NOT EXISTS password_reset_otps (
  otp_id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  otp_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_reset_otps_email_created
  ON password_reset_otps (LOWER(email), created_at DESC);

CREATE INDEX IF NOT EXISTS idx_password_reset_otps_user_active
  ON password_reset_otps (user_id, expires_at DESC)
  WHERE used_at IS NULL;
