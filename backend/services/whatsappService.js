/**
 * WhatsApp helpers for Support pickup OTP + damage image share.
 *
 * Disabled by default. Enable with SUPPORT_PICKUP_WHATSAPP_OTP=true once Twilio
 * WhatsApp templates and customer-consent flows are ready (Bug 4 — separate PR).
 *
 * Env (already used elsewhere): TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
 * TWILIO_WHATSAPP_FROM, TWILIO_WHATSAPP_TO (fallback/test destination).
 */
const crypto = require('crypto');

function isPickupWhatsAppOtpEnabled() {
  const v = String(process.env.SUPPORT_PICKUP_WHATSAPP_OTP || '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function hashOtp(otp) {
  const pepper = process.env.SUPPORT_OTP_PEPPER || process.env.JWT_SECRET || 'support-otp';
  return crypto.createHash('sha256').update(`${pepper}:${otp}`).digest('hex');
}

function generateNumericOtp(digits = 6) {
  const max = 10 ** digits;
  const n = crypto.randomInt(0, max);
  return String(n).padStart(digits, '0');
}

/**
 * Send a templated WhatsApp text (OTP). No-op when flag is off.
 * Full Twilio media/OTP wiring ships in the dedicated Bug 4 PR.
 */
async function sendWhatsAppText({ to, body }) {
  if (!isPickupWhatsAppOtpEnabled()) {
    return { sent: false, skipped: true, reason: 'SUPPORT_PICKUP_WHATSAPP_OTP disabled' };
  }
  // Placeholder — Twilio client call lands with Bug 4.
  console.warn('[whatsappService] sendWhatsAppText stub', { to, bodyLen: (body || '').length });
  return { sent: false, skipped: true, reason: 'stub' };
}

async function sendWhatsAppImage({ to, mediaUrl, caption }) {
  if (!isPickupWhatsAppOtpEnabled()) {
    return { sent: false, skipped: true, reason: 'SUPPORT_PICKUP_WHATSAPP_OTP disabled' };
  }
  console.warn('[whatsappService] sendWhatsAppImage stub', { to, mediaUrl, caption });
  return { sent: false, skipped: true, reason: 'stub' };
}

module.exports = {
  isPickupWhatsAppOtpEnabled,
  hashOtp,
  generateNumericOtp,
  sendWhatsAppText,
  sendWhatsAppImage,
};
