import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../utils/api';

/**
 * Keeps list filters in the URL and fetches the endpoint whenever they change.
 *
 * Filters living in the query string is what lets the dashboard KPI cards link
 * straight to a pre-filtered list, and lets the browser back button restore it.
 */
export default function useListQuery(path, { defaults = {}, resultKey }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, setState] = useState({ rows: [], pagination: null, loading: true, error: null });

  const filters = useMemo(() => {
    const merged = { page: 1, limit: 20, ...defaults };
    searchParams.forEach((v, k) => { merged[k] = v; });
    merged.page = Number(merged.page) || 1;
    merged.limit = Number(merged.limit) || 20;
    return merged;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const setFilters = useCallback((next) => {
    const params = {};
    Object.entries(next).forEach(([k, v]) => {
      if (v === '' || v == null) return;
      if (k === 'page' && Number(v) === 1) return;
      if (k === 'limit' && Number(v) === 20) return;
      params[k] = String(v);
    });
    setSearchParams(params, { replace: true });
  }, [setSearchParams]);

  const setPage = useCallback((page) => setFilters({ ...filters, page }), [filters, setFilters]);

  const query = useMemo(() => {
    const q = {};
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== '' && v != null) q[k] = v;
    });
    return q;
  }, [filters]);

  const queryKey = JSON.stringify(query);

  const load = useCallback(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    api.get(path, { params: JSON.parse(queryKey) })
      .then(({ data }) => {
        if (cancelled) return;
        setState({
          rows: data[resultKey] || [],
          pagination: data.pagination || null,
          loading: false,
          error: null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          rows: [],
          pagination: null,
          loading: false,
          error: err.response?.data?.message || 'Could not load this list',
        });
      });
    return () => { cancelled = true; };
  }, [path, queryKey, resultKey]);

  useEffect(() => load(), [load]);

  return { ...state, filters, setFilters, setPage, reload: load };
}
