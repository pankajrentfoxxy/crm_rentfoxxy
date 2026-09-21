import { useEffect, useMemo, useState } from 'react';
import api from '../../utils/api';

/**
 * Sell data (Part 4.5).
 *
 * The RentFoxxy / Gorefurbo split is a FILTER here, never two menu branches
 * (Decision 1). One laptop crossing books must not cross sections, and a user
 * asking "what did we sell this month" should not have to know which of two
 * screens to open.
 */
export function useSellList(resource, { entity = '', status = '', search = '', limit = 100 } = {}) {
  const [state, setState] = useState({ loading: true, error: null, rows: [], total: 0 });

  const query = useMemo(() => {
    const p = new URLSearchParams({ limit: String(limit) });
    if (entity) p.set('entity_code', entity);
    if (status) p.set('status', status);
    if (search) p.set('search', search);
    return p.toString();
  }, [entity, status, search, limit]);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    api.get(`/sales-management/${resource}?${query}`)
      .then(({ data }) => {
        if (cancelled) return;
        const rows = data?.rows || data?.data || data?.[resource] || [];
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
          error: err?.response?.data?.message || `Could not load ${resource}.`,
          rows: [], total: 0,
        });
      });

    return () => { cancelled = true; };
  }, [resource, query]);

  return state;
}
