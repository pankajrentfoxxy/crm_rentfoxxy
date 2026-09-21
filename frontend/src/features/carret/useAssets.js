import { useEffect, useMemo, useState } from 'react';
import api from '../../utils/api';

/**
 * Stock list data (Part 2.7).
 *
 * Reads the existing inventory-management endpoints rather than adding a
 * parallel API — hard rule 3, and the reason Part 2.5 was worth doing: those
 * endpoints now answer from the single availability predicate, so a list here
 * and SO attach cannot disagree.
 */
export function useAssetList({ segment = 'passed', filters = {}, limit = 100 }) {
  const [state, setState] = useState({ loading: true, error: null, rows: [], total: 0 });

  const query = useMemo(() => {
    const p = new URLSearchParams({ segment, limit: String(limit) });
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') p.set(k, v);
    });
    return p.toString();
  }, [segment, filters, limit]);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    api.get(`/inventory-management/lists?${query}`)
      .then(({ data }) => {
        if (cancelled) return;
        const rows = data?.rows || data?.data || data?.items || [];
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
          error: err?.response?.data?.message || 'Could not load assets.',
          rows: [], total: 0,
        });
      });

    return () => { cancelled = true; };
  }, [query]);

  return state;
}

/**
 * The lifecycle counts behind the Operations overview.
 *
 * Every number here traces to a canonical status or to asset_available
 * (Part 2.6). No tile is rendered from a value nothing writes, which is the
 * whole of finding I11.
 */
export function useFleetCounts() {
  const [state, setState] = useState({ loading: true, error: null, counts: null });

  useEffect(() => {
    let cancelled = false;
    api.get('/inventory-management/lists/counts')
      .then(({ data }) => {
        if (cancelled) return;
        setState({ loading: false, error: null, counts: data?.counts || data || null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          loading: false,
          error: err?.response?.data?.message || 'Could not load fleet counts.',
          counts: null,
        });
      });
    return () => { cancelled = true; };
  }, []);

  return state;
}
