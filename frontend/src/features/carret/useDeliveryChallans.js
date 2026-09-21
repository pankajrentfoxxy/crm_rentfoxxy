import { useEffect, useState, useMemo } from 'react';
import api from '../../utils/api';

/** Move screens data. Reads the existing endpoints — no parallel API (rule 3). */
export function useChallans({ status = '', movement = 'outbound', search = '', limit = 100 }) {
  const [state, setState] = useState({ loading: true, error: null, rows: [], total: 0 });

  const query = useMemo(() => {
    const p = new URLSearchParams({ limit: String(limit) });
    if (status) p.set('status', status);
    if (movement) p.set('movement_type', movement);
    if (search) p.set('search', search);
    return p.toString();
  }, [status, movement, search, limit]);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    api.get(`/sales-management/delivery-challans?${query}`)
      .then(({ data }) => {
        if (cancelled) return;
        const rows = data?.rows || data?.data || data?.challans || [];
        setState({
          loading: false, error: null,
          rows: Array.isArray(rows) ? rows : [],
          total: data?.total ?? (Array.isArray(rows) ? rows.length : 0),
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          loading: false,
          error: err?.response?.data?.message || 'Could not load challans.',
          rows: [], total: 0,
        });
      });

    return () => { cancelled = true; };
  }, [query]);

  return state;
}

/**
 * The gate pre-flight for one challan.
 *
 * Part 3.2: the guard screen has to show WHICH check failed and who to call,
 * which means asking before the guard scans rather than after they submit.
 */
export function useGatePreflight(dcNumber) {
  const [state, setState] = useState({ loading: false, ok: null, failures: [], error: null });

  useEffect(() => {
    if (!dcNumber) return undefined;
    let cancelled = false;
    setState({ loading: true, ok: null, failures: [], error: null });

    api.get(`/guard-gate/preflight/${encodeURIComponent(dcNumber)}`)
      .then(({ data }) => {
        if (cancelled) return;
        setState({
          loading: false,
          ok: Boolean(data?.ok),
          failures: Array.isArray(data?.failures) ? data.failures : [],
          error: null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          loading: false, ok: null, failures: [],
          error: err?.response?.data?.message || 'Could not run the pre-flight.',
        });
      });

    return () => { cancelled = true; };
  }, [dcNumber]);

  return state;
}
