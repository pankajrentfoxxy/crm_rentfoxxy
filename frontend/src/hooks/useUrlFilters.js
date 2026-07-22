import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import useDebouncedValue from './useDebouncedValue';

/**
 * URL-backed filter state.
 * defaults: { search: '', page: 1, status: '', dateFrom: '', dateTo: '' }
 * Values equal to their default are omitted from the URL (keeps it clean).
 */
export function useUrlFilters(defaults = {}) {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo(() => {
    const out = { ...defaults };
    Object.keys(defaults).forEach((k) => {
      const raw = searchParams.get(k);
      if (raw === null) return;
      out[k] = typeof defaults[k] === 'number' ? Number(raw) || defaults[k] : raw;
    });
    return out;
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const setFilters = useCallback((patch, opts = {}) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(patch).forEach(([k, v]) => {
        const isDefault = v === defaults[k] || v === '' || v == null;
        if (isDefault) next.delete(k);
        else next.set(k, String(v));
      });
      if (!('page' in patch)) next.delete('page');
      return next;
    }, { replace: opts.push !== true });
  }, [setSearchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetFilters = useCallback(
    () => setSearchParams(new URLSearchParams(), { replace: true }),
    [setSearchParams],
  );

  return { filters, setFilters, resetFilters };
}

/** Debounce a text input, then sync the debounced value into the URL filter `search` key. */
export function useDebouncedUrlSearch(filters, setFilters, ms = 320) {
  const urlSearch = filters.search || '';
  const [searchInput, setSearchInput] = useState(urlSearch);
  useEffect(() => { setSearchInput(urlSearch); }, [urlSearch]);
  const debouncedSearch = useDebouncedValue(searchInput.trim(), ms);
  useEffect(() => {
    if (debouncedSearch !== urlSearch) {
      setFilters({ search: debouncedSearch });
    }
  }, [debouncedSearch, urlSearch, setFilters]);
  return { searchInput, setSearchInput, debouncedSearch };
}

/** Debounce a single URL-backed text field (vendor, dc, etc.). */
export function useDebouncedUrlField(filters, setFilters, field, ms = 320) {
  const urlVal = filters[field] || '';
  const [input, setInput] = useState(urlVal);
  useEffect(() => { setInput(urlVal); }, [urlVal]);
  const debounced = useDebouncedValue(String(input).trim(), ms);
  useEffect(() => {
    if (debounced !== urlVal) {
      setFilters({ [field]: debounced });
    }
  }, [debounced, urlVal, field, setFilters]);
  return { input, setInput, debounced };
}

/** Pass as router state when navigating list → detail so Back can restore the filtered list URL. */
export function listReturnState(location) {
  return { from: `${location.pathname}${location.search}` };
}
