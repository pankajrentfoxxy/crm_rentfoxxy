/**
 * Checks and helpers for the customer profile in the new customer record.
 * Same rules as the backend (controllers/customerManagementController.js
 * updateCustomer): GSTIN 15 + format, PAN format, 10-digit mobile, email.
 */
import { GSTIN_RE } from '../sellShared';
import { INDIAN_STATES, matchIndianState } from '../../../../constants/indianStates';
import { indianMobileError } from '../../../../utils/phoneValidation';
import { getBackendOrigin } from '../../../../utils/api';

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const STATE_OPTIONS = INDIAN_STATES.map((s) => ({ value: s, label: s }));
export const COMPANY_TYPES = ['Pvt Ltd', 'LLP', 'Proprietorship', 'Partnership', 'Startup', 'NGO', 'Government', 'Other'];
export const DOC_TYPES = [
  { value: 'gst_certificate', label: 'GST certificate' },
  { value: 'pan_card', label: 'PAN card' },
  { value: 'agreement', label: 'Agreement' },
  { value: 'kyc_id', label: 'KYC ID' },
  { value: 'other', label: 'Other' },
];
export const DOC_TYPE_LABEL = Object.fromEntries(DOC_TYPES.map((d) => [d.value, d.label]));

/** GST state codes (first two digits of a GSTIN) → state name as INDIAN_STATES spells it. */
const GST_STATE = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', 10: 'Bihar', 11: 'Sikkim', 12: 'Arunachal Pradesh',
  13: 'Nagaland', 14: 'Manipur', 15: 'Mizoram', 16: 'Tripura', 17: 'Meghalaya', 18: 'Assam', 19: 'West Bengal',
  20: 'Jharkhand', 21: 'Odisha', 22: 'Chhattisgarh', 23: 'Madhya Pradesh', 24: 'Gujarat', 27: 'Maharashtra',
  29: 'Karnataka', 30: 'Goa', 32: 'Kerala', 33: 'Tamil Nadu', 36: 'Telangana', 37: 'Andhra Pradesh', 38: 'Ladakh',
  '04': 'Chandigarh', 26: 'Dadra and Nagar Haveli and Daman and Diu', 31: 'Lakshadweep', 34: 'Puducherry',
  35: 'Andaman and Nicobar Islands',
};
export const stateFromGstin = (g) => {
  const m = /^(\d{2})[A-Z]/.exec(String(g || '').toUpperCase());
  return m ? (GST_STATE[m[1]] || GST_STATE[Number(m[1])] || '') : '';
};
const norm = (s) => String(matchIndianState(s) || s || '').trim().toLowerCase();
export const sameState = (a, b) => norm(a) === norm(b);

/**
 * The state billing uses as the place of supply — the same rule as
 * backend services/billingGstService.customerPlaceOfSupply:
 * COALESCE(shipping_state, billing_state), where an empty shipping state counts
 * as "unknown" rather than falling back to billing.
 */
export function supplyState(shippingState, billingState) {
  const v = shippingState != null ? shippingState : billingState;
  return String(v ?? '').trim();
}

export const cleanGstin = (v) => String(v || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 15);
export const cleanPan = (v) => String(v || '').toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 10);

export function gstinProblem(v) {
  const g = cleanGstin(v);
  if (!g) return '';
  if (g.length !== 15) return `15 characters — ${g.length} entered`;
  return GSTIN_RE.test(g) ? '' : 'Not a valid GSTIN (like 06AAHCT0310N1ZG)';
}
export function panProblem(v) {
  const p = cleanPan(v);
  if (!p) return '';
  return PAN_RE.test(p) ? '' : '5 letters, 4 digits, 1 letter (like ABCDE1234F)';
}
export function emailProblem(v, { required = false } = {}) {
  const e = String(v || '').trim();
  if (!e) return required ? 'Required' : '';
  return EMAIL_RE.test(e) ? '' : 'Not a valid email';
}
export const mobileProblem = (v, { required = false } = {}) => indianMobileError(v, { required, label: 'Mobile' }) || '';
export const pincodeProblem = (v, { required = false } = {}) => {
  const p = String(v || '').trim();
  if (!p) return required ? 'Required' : '';
  return /^\d{6}$/.test(p) ? '' : '6 digits';
};

/** A stored upload path → a link on the backend (the /uploads cookie authorises it). */
export function uploadUrl(p) {
  if (!p) return null;
  if (/^(https?:|data:)/i.test(p)) return p;
  const clean = String(p).replace(/\\/g, '/').replace(/^\/+/, '');
  return `${getBackendOrigin().replace(/\/$/, '')}/${clean}`;
}

/* global process */ // CRA inlines process.env.REACT_APP_* at build time.
const PRODUCTION_PORTAL_URL = 'https://customer.rentfoxxy.com';
/** Same resolution as the old page: the API's URL, the build's, or production on a rentfoxxy host. */
export function portalUrl(fromApi) {
  const raw = String(fromApi || process.env.REACT_APP_CUSTOMER_PORTAL_URL || '').replace(/\/+$/, '');
  const isLocal = !raw || /localhost|127\.0\.0\.1/.test(raw);
  const onRentfoxxy = typeof window !== 'undefined' && /\.rentfoxxy\.com$/i.test(window.location.hostname);
  if (isLocal && onRentfoxxy) return PRODUCTION_PORTAL_URL;
  return raw || 'http://localhost:3002';
}
