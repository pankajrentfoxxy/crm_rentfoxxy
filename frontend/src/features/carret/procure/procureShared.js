/** Small shared bits for the Carret Procure screens. */
import api, { getBackendOrigin } from '../../../utils/api';

export const VENDOR_STATUSES = [
  { key: 'approved', label: 'Approved' },
  { key: 'pending', label: 'Pending' },
  { key: 'suspended', label: 'Suspended' },
];

export const vendorName = (v) => v?.business_name || [v?.f_name || v?.first_name, v?.l_name || v?.last_name].filter(Boolean).join(' ') || (v?.vendor_id ? `#${v.vendor_id}` : '—');

/** Uploaded files are stored as paths relative to the backend origin. */
export function fileUrl(p) {
  if (!p) return null;
  if (/^(https?:|data:)/i.test(p)) return p;
  return `${getBackendOrigin().replace(/\/$/, '')}/${String(p).replace(/^\//, '')}`;
}

export const errMsg = (e, fallback = 'That did not work.') => {
  const d = e?.response?.data;
  return d?.message || d?.errors?.[0]?.msg || e?.message || fallback;
};

export function fetchVendorActivity(id) {
  return api.get(`/vendor-management/vendors/${id}/activity`);
}

/** What a vendor-audit action means, in the team's words. */
const ACTIONS = {
  create: 'Vendor added',
  update: 'Vendor details changed',
  delete: 'Vendor removed',
  portal_access_update: 'Portal access changed',
  status_change: 'PO status changed',
  bill_upload: 'Bill uploaded',
  receive_unit_on_po_line: 'Laptop received',
  receive_bulk_on_spare_po_line: 'Spare parts received',
  status_auto_receive_progress: 'PO receiving progressed',
  ticket_created: 'Return ticket raised',
  vendor_notified: 'Vendor notified of a return',
  vrtdc_created: 'Return challan made',
  items_cancelled: 'Return items cancelled',
  line_specs_updated: 'PO line specs changed',
};
export const actionLabel = (a) => ACTIONS[a] || String(a || '').replace(/_/g, ' ');

/* ---------- vendor form <-> API (same field names as the old modal) ---------- */
const today = () => new Date().toISOString().slice(0, 10);
const slugState = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, '_');

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export function newPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const buf = new Uint32Array(12);
  window.crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join('');
}

export function emptyVendorForm() {
  return {
    status: 'pending', business_name: '', business_type: '', email: '', number: '', password: newPassword(),
    contact_person_name: '', contact_person_phone: '', alternate_phone: '',
    address: '', city: '', state: '', pincode: '',
    shipping_same: true, shipping_address: '', shipping_city: '', shipping_state: '', shipping_pincode: '',
    gst_number: '', pan_number: '', msme_number: '',
    bank_name: '', account_holder_name: '', account_number: '', bank_ifsc_code: '',
    po_payment_terms: 'postpaid_monthly', credit_days: '30', notes: '', registration_date: today(),
  };
}

/** A vendor row from the API → form values. Bank values may arrive as "hidden". */
export function vendorFormFromRow(v) {
  const f = emptyVendorForm();
  Object.keys(f).forEach((k) => { if (v[k] !== undefined && v[k] !== null) f[k] = typeof f[k] === 'boolean' ? v[k] !== false : String(v[k]); });
  f.number = String(v.phone || v.number || '').replace(/\D/g, '').slice(-10);
  f.state = slugState(v.state);
  f.password = '';
  f.registration_date = String(v.registration_date || '').slice(0, 10) || today();
  f.shipping_same = v.shipping_same !== false;
  return f;
}

export function vendorFormData(form, files = {}) {
  const fd = new FormData();
  const body = {
    ...form,
    f_name: form.contact_person_name?.trim() || form.business_name.trim(),
    l_name: '',
    from_submit: 'admin',
    gst_number: String(form.gst_number || '').trim().toUpperCase(),
    pan_number: String(form.pan_number || '').trim().toUpperCase(),
    bank_ifsc_code: String(form.bank_ifsc_code || '').trim().toUpperCase(),
    shipping_same: form.shipping_same ? 'true' : 'false',
  };
  Object.entries(body).forEach(([k, v]) => {
    if (k === 'password' && !v) return;
    fd.append(k, v ?? '');
  });
  if (files.gst_certificate) fd.append('gst_certificate', files.gst_certificate);
  if (files.licenses_and_permits) fd.append('licenses_and_permits', files.licenses_and_permits);
  if (files.image) fd.append('image', files.image);
  return fd;
}

/** Field errors in the words the team reads; empty when the form can go. */
export function vendorFormErrors(f, { isEdit, original } = {}) {
  const e = {};
  const req = (k, m = 'Required') => { if (!String(f[k] ?? '').trim()) e[k] = m; };
  ['business_name', 'address', 'bank_name', 'account_holder_name', 'account_number', 'bank_ifsc_code'].forEach((k) => req(k));
  req('business_type', 'Pick one');
  req('state', 'Pick the state');
  if (!/^\S+@\S+\.\S+$/.test(String(f.email || '').trim())) e.email = 'Enter a valid email';
  if (!/^[6-9]\d{9}$/.test(String(f.number || '').replace(/\D/g, '').slice(-10))) e.number = '10-digit mobile number';
  ['contact_person_phone', 'alternate_phone'].forEach((k) => {
    if (f[k] && !/^[6-9]\d{9}$/.test(String(f[k]).replace(/\D/g, '').slice(-10))) e[k] = '10-digit mobile number';
  });
  // Tax/bank formats: checked when new or changed, like the server — the
  // imported placeholders must not block an unrelated edit.
  const changed = (k) => !isEdit || String(f[k] || '').trim().toUpperCase() !== String(original?.[k] || '').trim().toUpperCase();
  const hidden = (k) => String(f[k]).toLowerCase() === 'hidden';
  const g = String(f.gst_number || '').trim().toUpperCase();
  if (g && changed('gst_number') && !GSTIN_RE.test(g)) e.gst_number = '15 characters, like 06AAHCT0310N1ZG';
  const p = String(f.pan_number || '').trim().toUpperCase();
  if (p && !hidden('pan_number') && changed('pan_number') && !PAN_RE.test(p)) e.pan_number = 'Like ABCDE1234F';
  const i = String(f.bank_ifsc_code || '').trim().toUpperCase();
  if (i && !hidden('bank_ifsc_code') && changed('bank_ifsc_code') && !IFSC_RE.test(i)) e.bank_ifsc_code = '11 characters, like HDFC0001234';
  if (!hidden('account_number') && f.account_number && !/^\d{6,20}$/.test(String(f.account_number).trim())) e.account_number = 'Digits only';
  if (!isEdit && String(f.password || '').length < 8) e.password = 'At least 8 characters';
  return e;
}
