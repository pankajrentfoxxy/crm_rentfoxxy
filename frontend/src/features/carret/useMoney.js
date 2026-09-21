import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../utils/api';

/**
 * Money data (Part 6.4).
 *
 * Every endpoint here already exists, and three of them existed with nothing
 * calling them: the payment ledger has worked for months with no UI (BL18), and
 * ageing and the statement of account were added in Part 6.2 precisely because
 * "how much is owed and how old is it" had no answer anywhere in this system.
 */

function qs(params) {
  const p = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    p.set(k, String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : '';
}

function useEndpoint(url, { skip = false } = {}) {
  const [state, setState] = useState({ loading: !skip, error: null, data: null });
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (skip) {
      setState({ loading: false, error: null, data: null });
      return undefined;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    api.get(url)
      .then(({ data }) => { if (!cancelled) setState({ loading: false, error: null, data }); })
      .catch((err) => {
        if (cancelled) return;
        setState({
          loading: false,
          error: err?.response?.data?.message || 'Could not load this.',
          data: null,
        });
      });
    return () => { cancelled = true; };
  }, [url, skip, nonce]);

  return { ...state, refresh };
}

export function useInvoices(filters = {}) {
  const url = useMemo(() => `/customer-billing/invoices${qs(filters)}`, [JSON.stringify(filters)]); // eslint-disable-line react-hooks/exhaustive-deps
  const { loading, error, data, refresh } = useEndpoint(url);
  const rows = useMemo(() => {
    const r = data?.invoices ?? data?.rows ?? data?.data;
    return Array.isArray(r) ? r : [];
  }, [data]);
  return { loading, error, rows, total: data?.total ?? rows.length, refresh };
}

/**
 * One invoice's timeline out of the single events table (BL11).
 *
 * This is the screen the audit rows exist for. Before Part 6.2 the answer to
 * "who sent this, who marked it paid, why was it cancelled" was nowhere at all.
 */
export function useInvoiceTimeline(invoiceId) {
  const { loading, error, data, refresh } = useEndpoint(
    `/customer-billing/invoices/${invoiceId}/timeline`,
    { skip: !invoiceId }
  );
  return {
    loading,
    error,
    events: useMemo(() => (Array.isArray(data?.events) ? data.events : []), [data]),
    refresh,
  };
}

/** The ledger that has worked for months with nothing calling it (BL18). */
export function useInvoicePayments(invoiceId) {
  const { loading, error, data, refresh } = useEndpoint(
    `/customer-billing/invoices/${invoiceId}/payments`,
    { skip: !invoiceId }
  );
  return {
    loading,
    error,
    payments: useMemo(() => (Array.isArray(data?.payments) ? data.payments : data?.rows || []), [data]),
    refresh,
  };
}

export function useAgeing(filters = {}) {
  const url = useMemo(() => `/customer-billing/ageing${qs(filters)}`, [JSON.stringify(filters)]); // eslint-disable-line react-hooks/exhaustive-deps
  const { loading, error, data, refresh } = useEndpoint(url);
  return {
    loading,
    error,
    rows: useMemo(() => (Array.isArray(data?.rows) ? data.rows : []), [data]),
    totals: data?.totals || {},
    refresh,
  };
}

export function useStatement(customerId, range = {}) {
  const url = useMemo(
    () => `/customer-billing/customers/${customerId}/statement${qs(range)}`,
    [customerId, JSON.stringify(range)] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const { loading, error, data, refresh } = useEndpoint(url, { skip: !customerId });
  return {
    loading,
    error,
    entries: useMemo(() => (Array.isArray(data?.entries) ? data.entries : []), [data]),
    closingBalance: data?.closing_balance ?? 0,
    refresh,
  };
}

/** Record a payment against an invoice — the write half of BL18. */
export function recordInvoicePayment(invoiceId, body) {
  return api.post(`/customer-billing/invoices/${invoiceId}/payments`, body);
}

/** BL13 — cancel with a reason, instead of a direct database write. */
export function cancelInvoice(invoiceId, reason) {
  return api.patch(`/customer-billing/invoices/${invoiceId}/cancel`, { reason });
}

/** BL9 — force the overdue sweep rather than waiting for the hourly worker. */
export function runOverdueSweep() {
  return api.post('/customer-billing/invoices/run-overdue-sweep', {});
}
