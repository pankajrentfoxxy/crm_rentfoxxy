/** Small shared bits for the Carret Sell screens. */
import { getBackendOrigin } from '../../../utils/api';

/** Any of these grants "create a sales order" — same list the backend's soCreate reads. */
export const SO_SECTIONS = ['sales_orders_doc', 'sales_orders_sale', 'sales_orders_rental', 'sales_orders_replacement'];
export const SO_CREATE_SECTIONS = SO_SECTIONS;

export function parseJson(v) {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

/** A stored pdf_path is absolute, or relative to the backend origin (same rule as the old pages). */
export function pdfUrl(p) {
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) return p;
  return `${getBackendOrigin().replace(/\/$/, '')}/${String(p).replace(/^\//, '')}`;
}

export function openPdf(path) {
  const url = pdfUrl(path);
  if (url) window.open(url, '_blank', 'noopener');
}

/**
 * Security deposit in months of rent (migration 407). The customer's default
 * (customers.security_deposit_months) is set when a lead is won and can be
 * changed on the customer; a new rental / demo order starts from it.
 */
export const SECURITY_OPTIONS = [
  { value: 'none', label: 'None', months: 0 },
  { value: 'one_month_rental', label: '1 month’s rent', months: 1 },
  { value: 'two_month_rental', label: '2 months’ rent', months: 2 },
  { value: 'three_month_rental', label: '3 months’ rent', months: 3 },
];
export const securityMonths = (type) => SECURITY_OPTIONS.find((o) => o.value === type)?.months || 0;
export const securityTypeFor = (months) => SECURITY_OPTIONS.find((o) => o.months === Number(months))?.value || 'none';
export const MONTH_CHOICES = [
  { value: '0', label: 'None' },
  { value: '1', label: '1 month’s rent' },
  { value: '2', label: '2 months’ rent' },
  { value: '3', label: '3 months’ rent' },
];

/** GSTIN: 2-digit state, PAN, entity, Z, check character — 15 in all. */
export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const validGstin = (v) => GSTIN_RE.test(String(v || '').trim().toUpperCase());
/** Legacy customer placeholders ("NA", "N/A-2", "Unknown") — not a GSTIN. */
export const gstinPlaceholder = (v) => /^(N\/?A|NIL|NONE|UNKNOWN|-)([-\s]*\d*)?$/i.test(String(v || '').trim());
/** The customer's GSTIN when it is a real one, else ''. */
export const customerGstin = (c) => {
  const g = String(c?.gst_no || c?.gst_number || '').trim().toUpperCase();
  return validGstin(g) ? g : '';
};
/** Error text for a GSTIN typed on a document; '' when fine or empty. */
export const gstinError = (v) => {
  const g = String(v || '').trim();
  if (!g || validGstin(g) || gstinPlaceholder(g)) return '';
  return g.length !== 15 ? `15 characters — ${g.length} entered` : 'Not a valid GSTIN (like 06AAHCT0310N1ZG)';
};
