/** Indian mobile: exactly 10 digits after stripping country code, spaces, and symbols. */
const MOBILE_RE = /^\d{10}$/;

function normalizeIndianMobile(value) {
  if (value == null || value === '') return '';
  let digits = String(value).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  else if (digits.length > 10) digits = digits.slice(-10);
  return digits;
}

function isValidIndianMobile(value) {
  return MOBILE_RE.test(normalizeIndianMobile(value));
}

function validateIndianMobile(value, { required = false, label = 'Phone' } = {}) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    if (required) return `${label} is required`;
    return null;
  }
  if (!isValidIndianMobile(trimmed)) return `${label} must be a 10-digit number`;
  return null;
}

/** @returns {{ ok: true, value: string|null } | { ok: false, error: string }} */
function parseIndianMobile(value, { required = false, label = 'Phone' } = {}) {
  const error = validateIndianMobile(value, { required, label });
  if (error) return { ok: false, error };
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return { ok: true, value: null };
  return { ok: true, value: normalizeIndianMobile(trimmed) };
}

const PHONE_BODY_FIELDS = new Set([
  'phone',
  'mobile_no',
  'mobile',
  'number',
  'customer_number',
  'contact_person_number',
  'contact_person_phone',
  'alternate_phone',
  'whatsapp_number',
  'whatsappNumber',
  'customer_phone',
  'ticket_phone_override',
  'ticket_alt_phone',
  'contact_mobile',
  'contactMobile',
  'finance_contact_mobile',
  'spock_person_mobile',
]);

function normalizePhoneFieldsInBody(body) {
  if (!body || typeof body !== 'object') return body;
  for (const key of Object.keys(body)) {
    if (!PHONE_BODY_FIELDS.has(key)) continue;
    const raw = body[key];
    if (raw == null || String(raw).trim() === '') continue;
    body[key] = normalizeIndianMobile(raw);
  }
  return body;
}

module.exports = {
  MOBILE_RE,
  normalizeIndianMobile,
  isValidIndianMobile,
  validateIndianMobile,
  parseIndianMobile,
  normalizePhoneFieldsInBody,
};
