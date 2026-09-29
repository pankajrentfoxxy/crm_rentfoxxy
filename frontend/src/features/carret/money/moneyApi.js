import { useEffect, useMemo, useState } from 'react';
import api from '../../../utils/api';

/**
 * Customer money API (Builder 1). Every call here is an existing
 * /api/customer-billing endpoint except two added with the MD fixes:
 * GET /payments (Payments received) and PATCH /credit-notes/:id/cancel.
 */
const base = '/customer-billing';

export const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTH_OPTIONS = MONTHS.slice(1).map((label, i) => ({ value: String(i + 1), label }));
export const yearOptions = () => {
  const now = new Date().getFullYear();
  return Array.from({ length: 6 }, (_, i) => String(now + 1 - i)).map((y) => ({ value: y, label: y }));
};
export const PAYMENT_METHODS = [
  { value: 'neft', label: 'NEFT / RTGS' },
  { value: 'imps', label: 'IMPS' },
  { value: 'upi', label: 'UPI' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Card' },
  { value: 'adjustment', label: 'Adjustment' },
];

export const errMsg = (e, fallback = 'Something went wrong') => e?.response?.data?.message || e?.message || fallback;

/** A fresh key per form open: a double click, or a retry after a timeout, posts once. */
export const newRequestKey = (prefix = 'pay') => {
  const rnd = (typeof window !== 'undefined' && window.crypto?.randomUUID)
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${rnd}`.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 80);
};

export const todayYmd = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** A blob response that is really a JSON error carries the message inside. */
export async function blobErrMsg(e, fallback) {
  const data = e?.response?.data;
  if (data instanceof Blob) {
    try { return JSON.parse(await data.text()).message || fallback; } catch { return fallback; }
  }
  return errMsg(e, fallback);
}

export function saveBlob(data, filename, type) {
  const url = window.URL.createObjectURL(new Blob([data], type ? { type } : undefined));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}

// Invoices
export const listInvoices = (params) => api.get(`${base}/invoices`, { params });
export const getInvoice = (id) => api.get(`${base}/invoices/${id}`);
export const listCoverage = (params) => api.get(`${base}/invoices/coverage`, { params });
export const generateInvoicesBulk = (body) => api.post(`${base}/invoices/generate-bulk`, body);
export const sendInvoice = (id, body) => api.post(`${base}/invoices/${id}/send`, body);
export const markZoho = (id, body) => api.post(`${base}/invoices/${id}/mark-zoho`, body);
export const markPaid = (id, body, key) => api.patch(`${base}/invoices/${id}/paid`, body, { headers: { 'Idempotency-Key': key } });
export const cancelInvoice = (id, reason) => api.patch(`${base}/invoices/${id}/cancel`, { reason });
export const recordPayment = (id, body, key) => api.post(`${base}/invoices/${id}/payments`, body, { headers: { 'Idempotency-Key': key } });
export const listInvoicePayments = (id) => api.get(`${base}/invoices/${id}/payments`);
export const invoiceTimeline = (id) => api.get(`${base}/invoices/${id}/timeline`);
export const invoicePdf = (id, format = 'tax_invoice') => api.get(`${base}/invoices/${id}/pdf`, { params: { format }, responseType: 'blob' });
export const invoicesZip = (params) => api.get(`${base}/invoices/pdf-zip`, { params, responseType: 'blob', timeout: 15 * 60 * 1000 });
export const invoicesExcel = (params) => api.get(`${base}/invoices/export.xlsx`, { params, responseType: 'blob', timeout: 5 * 60 * 1000 });

// E-invoice / e-way bill — /api/einvoice, keyed by DC (section einvoice_ewb).
// The e-way bill is written to the DC's lines, so the invoice row can lag; the
// DC status is the fresher source for the number, validity and QR.
export const dcEinvoiceStatus = (dc) => api.get(`/einvoice/dc/${encodeURIComponent(dc)}/status`);
export const generateDcEwb = (dc, body) => api.post(`/einvoice/dc/${encodeURIComponent(dc)}/ewb`, body);
export const EWB_MODES = [
  { value: 'road', label: 'Road' },
  { value: 'rail', label: 'Rail' },
  { value: 'air', label: 'Air' },
  { value: 'ship', label: 'Ship' },
];

// Payments received
export const listPayments = (params) => api.get(`${base}/payments`, { params });

// Credit notes
export const listCreditNotes = (params) => api.get(`${base}/credit-notes`, { params });
export const listCreditNoteLaptops = (params) => api.get(`${base}/credit-notes/laptops`, { params });
export const getCreditNote = (id) => api.get(`${base}/credit-notes/${id}`);
export const createCreditNote = (body) => api.post(`${base}/credit-notes`, body);
export const approveCreditNote = (id, body) => api.patch(`${base}/credit-notes/${id}/approve`, body || {});
export const approveCreditNotesBulk = (ids) => api.post(`${base}/credit-notes/approve-bulk`, { ids });
export const cancelCreditNote = (id, reason) => api.patch(`${base}/credit-notes/${id}/cancel`, { reason });
export const generateCreditNotesBulk = (body) => api.post(`${base}/credit-notes/generate-bulk`, body);
export const creditNotePdf = (id) => api.get(`${base}/credit-notes/${id}/pdf`, { params: { format: 'laptop_details' }, responseType: 'blob' });
export const creditNotesZip = (params) => api.get(`${base}/credit-notes/pdf-zip`, { params: { format: 'laptop_details', ...params }, responseType: 'blob', timeout: 15 * 60 * 1000 });

// Security deposits
export const listDeposits = (params) => api.get(`${base}/security-deposits`, { params });
export const recordDeposit = (body, key) => api.post(`${base}/security-deposits`, body, { headers: { 'Idempotency-Key': key } });

// Delivery charges
export const getDeliveryCharges = (params) => api.get(`${base}/delivery-charges`, { params });
export const deliveryChargesExcel = (params) => api.get(`${base}/delivery-charges/export.xlsx`, { params, responseType: 'blob' });
export const deliveryChargesStatement = (params) => api.get(`${base}/delivery-charges/statement.pdf`, { params, responseType: 'blob', timeout: 2 * 60 * 1000 });

/**
 * Customer pick-list for SearchSelect. The customers list needs `customers`
 * view; without it the pick-list is simply empty and the lists still work.
 */
export function useCustomerOptions() {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    let off = false;
    api.get('/customer-management/customers/ids')
      .then(({ data }) => { if (!off) setRows(data?.customers || []); })
      .catch(() => { if (!off) setRows([]); });
    return () => { off = true; };
  }, []);
  return useMemo(() => rows.map((c) => ({
    value: String(c.customer_id),
    label: c.company_name || c.name || `Customer #${c.customer_id}`,
    search: [c.email, c.phone].filter(Boolean).join(' '),
  })), [rows]);
}
