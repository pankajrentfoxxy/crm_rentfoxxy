const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { sendEmailImmediate } = require('./emailQueueService');

const OTP_EXPIRY_MINUTES = 10;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const MAX_VERIFY_ATTEMPTS = 5;
const MIN_PASSWORD_LENGTH = 8;

const GENERIC_SUCCESS_MESSAGE =
  'If an account exists for this email, a verification code has been sent.';

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const hashOtp = (otp, email) => {
  const secret = process.env.JWT_SECRET || 'password-reset-otp';
  return crypto.createHmac('sha256', `${secret}:${email}`).update(String(otp)).digest('hex');
};

const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

const validateNewPassword = (password) => {
  const value = String(password || '');
  if (value.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  return { ok: true, value };
};

const findEligibleUser = async (email) => {
  const result = await pool.query(
    `SELECT user_id, name, email, role, status, active
     FROM users
     WHERE LOWER(email) = $1
       AND active = true
       AND COALESCE(status, 'active') = 'active'`,
    [email]
  );
  return result.rows[0] || null;
};

const getLatestOtpRow = async (email) => {
  const result = await pool.query(
    `SELECT *
     FROM password_reset_otps
     WHERE LOWER(email) = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [email]
  );
  return result.rows[0] || null;
};

const sendOtpEmail = async ({ email, name, otp }) => {
  const subject = 'Rentfoxxy password reset code';
  const bodyText = [
    `Hello ${name || 'there'},`,
    '',
    `Your password reset verification code is: ${otp}`,
    '',
    `This code expires in ${OTP_EXPIRY_MINUTES} minutes.`,
    'If you did not request this, you can ignore this email.',
    '',
    '— Rentfoxxy Technologies',
  ].join('\n');
  const bodyHtml = `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #0f172a;">
      <p>Hello ${name || 'there'},</p>
      <p>Use this verification code to reset your password:</p>
      <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px; margin: 16px 0;">${otp}</p>
      <p style="color: #64748b; font-size: 13px;">This code expires in ${OTP_EXPIRY_MINUTES} minutes.</p>
      <p style="color: #64748b; font-size: 13px;">If you did not request this, you can ignore this email.</p>
      <p style="color: #64748b; font-size: 12px;">— Rentfoxxy Technologies</p>
    </div>
  `;

  await sendEmailImmediate({ toEmail: email, subject, bodyText, bodyHtml });
};

async function requestPasswordResetOtp(rawEmail) {
  const email = normalizeEmail(rawEmail);
  if (!email) {
    return { ok: false, status: 400, message: 'Email is required' };
  }

  const user = await findEligibleUser(email);
  if (!user) {
    return {
      ok: true,
      status: 200,
      message: GENERIC_SUCCESS_MESSAGE,
      expiresInMinutes: OTP_EXPIRY_MINUTES,
    };
  }

  const latest = await getLatestOtpRow(email);
  if (latest && !latest.used_at) {
    const secondsSince = (Date.now() - new Date(latest.created_at).getTime()) / 1000;
    if (secondsSince < OTP_RESEND_COOLDOWN_SECONDS) {
      const waitSeconds = Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - secondsSince);
      return {
        ok: false,
        status: 429,
        message: `Please wait ${waitSeconds}s before requesting another code`,
        retryAfterSeconds: waitSeconds,
      };
    }
  }

  const otp = generateOtp();
  const otpHash = hashOtp(otp, email);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  await pool.query(
    `UPDATE password_reset_otps
     SET used_at = NOW()
     WHERE LOWER(email) = $1 AND used_at IS NULL`,
    [email]
  );

  await pool.query(
    `INSERT INTO password_reset_otps (user_id, email, otp_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [user.user_id, email, otpHash, expiresAt]
  );

  try {
    await sendOtpEmail({ email: user.email, name: user.name, otp });
  } catch (error) {
    console.error('Password reset OTP email error:', error);
    return {
      ok: false,
      status: 503,
      message: 'Unable to send verification email right now. Please try again later.',
    };
  }

  return {
    ok: true,
    status: 200,
    message: GENERIC_SUCCESS_MESSAGE,
    expiresInMinutes: OTP_EXPIRY_MINUTES,
  };
}

async function resetPasswordWithOtp(rawEmail, rawOtp, rawPassword) {
  const email = normalizeEmail(rawEmail);
  const otp = String(rawOtp || '').trim();
  const passwordCheck = validateNewPassword(rawPassword);

  if (!email) {
    return { ok: false, status: 400, message: 'Email is required' };
  }
  if (!/^\d{6}$/.test(otp)) {
    return { ok: false, status: 400, message: 'Enter the 6-digit verification code' };
  }
  if (!passwordCheck.ok) {
    return { ok: false, status: 400, message: passwordCheck.error };
  }

  const user = await findEligibleUser(email);
  if (!user) {
    return { ok: false, status: 400, message: 'Invalid or expired verification code' };
  }

  const row = await getLatestOtpRow(email);
  if (!row || row.used_at || row.user_id !== user.user_id) {
    return { ok: false, status: 400, message: 'Invalid or expired verification code' };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, status: 400, message: 'Verification code has expired. Request a new one.' };
  }
  if (row.attempts >= MAX_VERIFY_ATTEMPTS) {
    return { ok: false, status: 400, message: 'Too many failed attempts. Request a new code.' };
  }

  const expectedHash = hashOtp(otp, email);
  if (expectedHash !== row.otp_hash) {
    await pool.query(
      'UPDATE password_reset_otps SET attempts = attempts + 1 WHERE otp_id = $1',
      [row.otp_id]
    );
    return { ok: false, status: 400, message: 'Invalid or expired verification code' };
  }

  const passwordHash = await bcrypt.hash(passwordCheck.value, 10);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'UPDATE users SET password_hash = $1, remember_pass_plain = $2, updated_at = NOW() WHERE user_id = $3',
      [passwordHash, passwordCheck.value, user.user_id]
    );
    await client.query(
      'UPDATE password_reset_otps SET used_at = NOW() WHERE otp_id = $1',
      [row.otp_id]
    );
    await client.query(
      `UPDATE password_reset_otps
       SET used_at = NOW()
       WHERE LOWER(email) = $1 AND used_at IS NULL`,
      [email]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  return {
    ok: true,
    status: 200,
    message: 'Password updated successfully. You can sign in with your new password.',
  };
}

module.exports = {
  requestPasswordResetOtp,
  resetPasswordWithOtp,
  OTP_EXPIRY_MINUTES,
  OTP_RESEND_COOLDOWN_SECONDS,
};
