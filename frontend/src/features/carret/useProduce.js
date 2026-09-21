import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../utils/api';

/**
 * Procure & Produce data (Part 5.7).
 *
 * Every hook here reads an endpoint that already exists. Part 5 did not add a
 * parallel API for the new screens — contract rule 3 — so what changed on the
 * backend is what these read back: the stored configuration verification on a
 * GRN, inventory_status on a received unit, qc_fail_count and the escalation
 * on a floor ticket.
 */

function useEndpoint(url, { skip = false, pick } = {}) {
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
      .then(({ data }) => {
        if (cancelled) return;
        setState({ loading: false, error: null, data: pick ? pick(data) : data });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          loading: false,
          error: err?.response?.data?.message || 'Could not load this list.',
          data: null,
        });
      });

    return () => { cancelled = true; };
    // `pick` is a render-stable selector by convention; url + nonce drive the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, skip, nonce]);

  return { ...state, refresh };
}

function qs(params) {
  const p = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    p.set(k, String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** Rows out of whichever envelope the endpoint happens to use. */
function rowsFrom(data, ...keys) {
  if (!data) return [];
  for (const k of keys) {
    const v = data[k] ?? data?.data?.[k];
    if (Array.isArray(v)) return v;
  }
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.rows)) return data.rows;
  return [];
}

/**
 * Purchase orders, vendors, spare parts orders, vendor returns, vendor repair.
 *
 * `path` is the endpoint, given in full, because Vendor Repair lives under
 * /vendor-repair and everything else under /vendor-management. Guessing a base
 * from the resource name would be the kind of convenient assumption that ends
 * with two of something.
 */
export function useProcureList(path, filters = {}) {
  const url = useMemo(() => `${path}${qs(filters)}`, [path, JSON.stringify(filters)]); // eslint-disable-line react-hooks/exhaustive-deps
  const { loading, error, data, refresh } = useEndpoint(url);
  const rows = useMemo(
    () => rowsFrom(data, 'purchase_orders', 'vendors', 'spare_parts_orders', 'dcs', 'items', 'rows', 'list'),
    [data]
  );
  return { loading, error, rows, total: data?.total ?? data?.data?.total ?? rows.length, refresh };
}

/**
 * The floor pipeline: how many tickets sit at each stage right now.
 *
 * Stage order comes from the API, which after migration 270 is finally a total
 * order — Dispatch QC used to share stage_order 10 with QC2, so two stages
 * arrived in whatever sequence the planner chose.
 */
export function useFloorPipeline() {
  const { loading, error, data, refresh } = useEndpoint('/tickets/floor-dashboard');
  const stages = useMemo(() => rowsFrom(data, 'by_stage', 'byStage', 'stages'), [data]);
  return { loading, error, stages, dashboard: data?.data || data || {}, refresh };
}

/** Tickets, optionally at one stage. The stage is a filter, not a screen. */
export function useFloorTickets({ stage = '', search = '', priority = '', status = '' } = {}) {
  const url = useMemo(
    () => `/tickets${qs({ stage_names: stage || undefined, search, priority, status })}`,
    [stage, search, priority, status]
  );
  const { loading, error, data, refresh } = useEndpoint(url);
  const rows = useMemo(() => rowsFrom(data, 'tickets', 'rows'), [data]);
  return { loading, error, rows, total: rows.length, refresh };
}

/** Parts on the floor, with the brand/model the spare chain now carries. */
export function usePartInstances(filters = {}) {
  const url = useMemo(() => `/part-requests/instances${qs(filters)}`, [JSON.stringify(filters)]); // eslint-disable-line react-hooks/exhaustive-deps
  const { loading, error, data, refresh } = useEndpoint(url);
  const rows = useMemo(() => rowsFrom(data, 'instances'), [data]);
  // The dropdown options come from the whole of stock, not from `rows`. A
  // filter list that narrows as you filter can only tell you what you have
  // already excluded.
  const filterOptions = data?.filters || { brands: [], models: [], models_by_brand: {}, categories: [] };
  return { loading, error, rows, filterOptions, refresh };
}
