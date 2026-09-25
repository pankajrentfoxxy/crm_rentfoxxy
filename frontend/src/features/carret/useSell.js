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
// Each list endpoint names its rows differently; read the real key first.
const ROW_KEYS = { quotations: 'quotations', 'sales-orders': 'sales_orders', customers: 'customers' };
// The SO list filters by book through entity_scope (sale | rental), not entity_code.
const SO_SCOPE = { rentfoxxy: 'rental', gorefurbo: 'sale' };
// Customers live under customer-management; there is no sales-management list.
const URLS = { customers: '/customer-management/customers' };
const CUSTOMER_TYPE = { rentfoxxy: 'rental', gorefurbo: 'sales' };

export function useSellList(resource, {
  entity = '', status = '', search = '', page = 1, limit = 50, refreshKey = 0,
} = {}) {
  const [state, setState] = useState({ loading: true, error: null, rows: [], total: 0, pages: 1, stats: null });

  const query = useMemo(() => {
    const p = new URLSearchParams({ limit: String(limit), page: String(page) });
    if (entity) {
      if (resource === 'sales-orders') p.set('entity_scope', SO_SCOPE[entity] || entity);
      else if (resource === 'customers') p.set('customer_type', CUSTOMER_TYPE[entity] || 'all');
      else p.set('entity_code', entity);
    }
    if (status) p.set('status', status);
    if (search) p.set('search', search);
    return p.toString();
  }, [resource, entity, status, search, page, limit]);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));

    api.get(`${URLS[resource] || `/sales-management/${resource}`}?${query}`)
      .then(({ data }) => {
        if (cancelled) return;
        const rows = data?.[ROW_KEYS[resource]] || data?.rows || data?.data || data?.[resource] || [];
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
          error: err?.response?.data?.message || `Could not load ${resource}.`,
          rows: [], total: 0, pages: 1, stats: null,
        });
      });

    return () => { cancelled = true; };
  }, [resource, query, refreshKey]);

  return state;
}
