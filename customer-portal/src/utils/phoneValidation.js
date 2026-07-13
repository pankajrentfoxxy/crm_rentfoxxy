export const INDIAN_MOBILE_RE = /^\d{10}$/;

export function normalizeIndianMobile(value) {
  if (value == null || value === '') return '';
  let digits = String(value).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  else if (digits.length > 10) digits = digits.slice(-10);
  return digits;
}

export function isValidIndianMobile(value) {
  return INDIAN_MOBILE_RE.test(normalizeIndianMobile(value));
}

export function formatIndianMobileInput(value) {
  return normalizeIndianMobile(value).slice(0, 10);
}

export function indianMobileError(value, { required = false, label = 'Phone' } = {}) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    if (required) return `${label} is required`;
    return null;
  }
  if (!isValidIndianMobile(trimmed)) return `${label} must be a 10-digit number`;
  return null;
}
