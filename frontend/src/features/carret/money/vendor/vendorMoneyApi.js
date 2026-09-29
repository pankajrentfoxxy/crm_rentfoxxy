import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../../../utils/api';

/**
 * Finance → Vendors: vendor bills, debit notes, vendor payments.
 * Every call is the existing /api/vendor-billing API (MD5/MD6 fixes live there).
 */
const base = '/vendor-billing';

export const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (m, y) => (m && y ? `${MONTHS[Number(m)] || m} ${y}` : '—');

export const BILL_STATUS_LABEL = {
  generated: 'Awaiting approval',
  approved: 'Approved',
  partially_paid: 'Part paid',
  paid: 'Paid',
  disputed: 'Disputed',
  cancelled: 'Cancelled',
};
/** StatusChip knows these document words; map the bill's own to them. */
export const billChipStatus = (s) => ({
  generated: 'pending', approved: 'approved', partially_paid: 'partial', paid: 'paid', disputed: 'overdue', cancelled: 'cancelled',
}[s] || s);

export const DN_STATUS_LABEL = {
  pending: 'Pending', approved: 'Approved — waits for the next bill', adjusted: 'Deducted on a bill', cancelled: 'Cancelled',
};
export const dnChipStatus = (s) => ({ pending: 'pending', approved: 'approved', adjusted: 'completed', cancelled: 'cancelled' }[s] || s);
export const isDraftNote = (n) => n && n.status === 'pending' && !(Number(n.amount) > 0);

export const PAYMENT_METHODS = [
  { value: 'neft', label: 'NEFT' },
  { value: 'rtgs', label: 'RTGS' },
  { value: 'imps', label: 'IMPS' },
  { value: 'upi', label: 'UPI' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'cash', label: 'Cash' },
  { value: 'adjustment', label: 'Adjustment' },
];

export const errMsg = (e, fallback = 'That did not work.') => {
  const d = e?.response?.data;
  return d?.message || d?.errors?.[0]?.msg || e?.message || fallback;
};

export function todayIst() {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

export function outstandingOf(bill) {
  if (!bill) return 0;
  return Math.max(0, Math.round((Number(bill.total_payable || 0) - Number(bill.amount_paid || 0)) * 100) / 100);
}

function useFetch(fetcher, deps) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetcher()
      .then(({ data }) => { if (!cancelled) setState({ loading: false, error: null, data }); })
      .catch((e) => { if (!cancelled) setState({ loading: false, error: errMsg(e, 'Could not load this.'), data: null }); });
    return () => { cancelled = true; };
  }, [...deps, nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, refresh };
}

const clean = (params) => Object.fromEntries(
  Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '')
);

/** Vendors with rental POs or bills; `all` = every active vendor (debit notes). */
export function useBillableVendors(all = false) {
  const { data, loading } = useFetch(() => api.get(`${base}/vendors`, { params: all ? { scope: 'all' } : {} }), [all]);
  const vendors = useMemo(() => (Array.isArray(data?.vendors) ? data.vendors : []), [data]);
  return { vendors, loading };
}

export function useVendorBills(params) {
  const key = JSON.stringify(clean(params));
  const res = useFetch(() => api.get(`${base}/bills`, { params: clean(params) }), [key]);
  return {
    ...res,
    rows: Array.isArray(res.data?.bills) ? res.data.bills : [],
    summary: res.data?.summary || {},
    pagination: res.data?.pagination || { page: 1, totalPages: 1, total: 0 },
  };
}

export function useVendorBill(billId) {
  const bill = useFetch(() => api.get(`${base}/bills/${billId}`), [billId]);
  const payments = useFetch(() => api.get(`${base}/bills/${billId}/payments`), [billId]);
  const timeline = useFetch(() => api.get(`${base}/bills/${billId}/timeline`), [billId]);
  const refresh = useCallback(() => { bill.refresh(); payments.refresh(); timeline.refresh(); }, [bill.refresh, payments.refresh, timeline.refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    loading: bill.loading,
    error: bill.error,
    bill: bill.data?.bill || null,
    debitNotes: Array.isArray(bill.data?.debit_notes) ? bill.data.debit_notes : [],
    payments: Array.isArray(payments.data?.payments) ? payments.data.payments : [],
    events: Array.isArray(timeline.data?.events) ? timeline.data.events : [],
    refresh,
  };
}

export function useDebitNotes(params) {
  const key = JSON.stringify(clean(params));
  const res = useFetch(() => api.get(`${base}/debit-notes`, { params: clean(params) }), [key]);
  return { ...res, rows: Array.isArray(res.data?.debit_notes) ? res.data.debit_notes : [] };
}

export function useDebitNote(id) {
  const res = useFetch(() => api.get(`${base}/debit-notes/${id}`), [id]);
  return {
    ...res,
    note: res.data?.debit_note || null,
    events: Array.isArray(res.data?.events) ? res.data.events : [],
  };
}

export function useVendorPayments(params) {
  const key = JSON.stringify(clean(params));
  const res = useFetch(() => api.get(`${base}/payments`, { params: clean(params) }), [key]);
  return {
    ...res,
    rows: Array.isArray(res.data?.payments) ? res.data.payments : [],
    total: res.data?.total || 0,
    totalAmount: res.data?.total_amount || 0,
  };
}

export const generateVendorBill = (body) => api.post(`${base}/bills/generate`, body);
export const approveVendorBill = (id) => api.patch(`${base}/bills/${id}/approve`);
export const cancelVendorBill = (id, reason) => api.patch(`${base}/bills/${id}/cancel`, { reason });
export const recordVendorPayment = (id, body) => api.post(`${base}/bills/${id}/payments`, body);
export const payVendorBillInFull = (id, body) => api.patch(`${base}/bills/${id}/paid`, body);

export const createDebitNote = (body) => api.post(`${base}/debit-notes`, body);
export const setDebitNoteAmount = (id, body) => api.patch(`${base}/debit-notes/${id}`, body);
export const approveDebitNote = (id) => api.patch(`${base}/debit-notes/${id}/approve`);
export const cancelDebitNote = (id, reason) => api.patch(`${base}/debit-notes/${id}/cancel`, { reason });

/** The bill PDF the old screen offered, as a download. */
export async function downloadVendorBillPdf(bill) {
  const res = await api.get(`${base}/bills/${bill.bill_id}/pdf`, { responseType: 'blob' });
  const url = window.URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${String(bill.bill_number || 'vendor-bill').replace(/[^\w-]+/g, '_')}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}
