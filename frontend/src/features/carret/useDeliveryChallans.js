import { useEffect, useState, useMemo } from 'react';
import api from '../../utils/api';

/**
 * Move screens data. Reads the existing endpoints — no parallel API (rule 3).
 * Outbound challans: GET /delivery-challans → { delivery_challans, stats, pagination }.
 * Return challans live on their own endpoint: GET /return-dc → { return_dcs, pagination }.
 */
export function useChallans({ status = '', movement = 'outbound', search = '', page = 1, limit = 25, refreshKey = 0 }) {
  const [state, setState] = useState({ loading: true, error: null, rows: [], total: 0, pages: 1, stats: null });

  const query = useMemo(() => {
    const p = new URLSearchParams({ limit: String(limit), page: String(page) });
    if (status) p.set('status', status);
    if (search) p.set('search', search);
    return p.toString();
  }, [status, search, page, limit]);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    const url = movement === 'return' ? '/sales-management/return-dc' : '/sales-management/delivery-challans';

    api.get(`${url}?${query}`)
      .then(({ data }) => {
        if (cancelled) return;
        const rows = data?.delivery_challans || data?.return_dcs || data?.rows || [];
        const list = Array.isArray(rows) ? rows : [];
        setState({
          loading: false, error: null,
          rows: list,
          total: data?.pagination?.total ?? data?.total ?? list.length,
          pages: data?.pagination?.totalPages || 1,
          stats: data?.stats || null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          loading: false,
          error: err?.response?.data?.message || 'Could not load challans.',
          rows: [], total: 0, pages: 1, stats: null,
        });
      });

    return () => { cancelled = true; };
  }, [query, movement, refreshKey]);

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
