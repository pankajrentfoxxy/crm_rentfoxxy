import { useEffect, useState } from 'react';
import api from '../../utils/api';

/**
 * Part 2.7 — the Timeline's real data source.
 *
 * Part 1 built <Timeline> against a fixture precisely so the shape could be
 * agreed before the table existed. The shape did not change: the fixture rows
 * and these rows are the same `events` columns, so wiring it up was a swap of
 * the source and nothing else.
 */
export default function useAssetTimeline(ttspl) {
  const [state, setState] = useState({ loading: true, error: null, asset: null, events: [] });

  useEffect(() => {
    if (!ttspl) return undefined;
    let cancelled = false;

    setState((s) => ({ ...s, loading: true, error: null }));
    api.get(`/inventory-management/assets/${encodeURIComponent(ttspl)}/timeline`)
      .then(({ data }) => {
        if (cancelled) return;
        setState({
          loading: false,
          error: null,
          asset: data?.asset || null,
          events: Array.isArray(data?.events) ? data.events : [],
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          loading: false,
          // The message a user can act on, not the axios default.
          error: err?.response?.status === 404
            ? `No asset found for ${ttspl}.`
            : (err?.response?.data?.message || 'Could not load this asset.'),
          asset: null,
          events: [],
        });
      });

    return () => { cancelled = true; };
  }, [ttspl]);

  return state;
}
