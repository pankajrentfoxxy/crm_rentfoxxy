import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

const NUMERIC_KEYS = new Set(['month', 'year']);

/**
 * URL-backed report filters — survive back navigation, refresh, and sharing.
 * Filter edits use replace: true so browser history is not flooded.
 *
 * @param {Object} defaults - values when URL params are absent
 * @param {string[]} keys - filter keys synced with the query string
 */
export function useReportFiltersFromUrl(defaults, keys) {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo(() => {
    const next = { ...defaults };
    keys.forEach((key) => {
      const raw = searchParams.get(key);
      if (raw === null || raw === '') return;
      if (NUMERIC_KEYS.has(key)) {
        const n = Number(raw);
        if (!Number.isNaN(n)) next[key] = n;
      } else {
        next[key] = raw;
      }
    });
    return next;
  }, [searchParams, defaults, keys]);

  const setFilters = useCallback((next) => {
    setSearchParams((prev) => {
      const sp = new URLSearchParams(prev);
      keys.forEach((key) => {
        const v = next[key];
        if (v === '' || v == null || v === undefined) sp.delete(key);
        else sp.set(key, String(v));
      });
      return sp;
    }, { replace: true });
  }, [setSearchParams, keys]);

  return [filters, setFilters];
}

/**
 * Patch arbitrary query params on the current URL.
 * @param {Object} patch - key/value pairs; null/empty deletes the key
 * @param {{ replace?: boolean }} opts - replace history entry (default true)
 */
export function useUrlFilterPatch() {
  const [searchParams, setSearchParams] = useSearchParams();

  const setFilter = useCallback((patch, { replace = true } = {}) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(patch).forEach(([k, v]) => {
        if (v === '' || v == null || v === undefined) next.delete(k);
        else next.set(k, String(v));
      });
      return next;
    }, { replace });
  }, [setSearchParams]);

  const get = useCallback((key, fallback = '') => searchParams.get(key) || fallback, [searchParams]);

  return { searchParams, setFilter, get };
}
