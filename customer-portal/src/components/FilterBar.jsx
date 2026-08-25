import React, { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

const INPUT = 'border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-brand/30 focus:border-brand outline-none';

/**
 * fields: [{ key, label, options: [{ value, label }] }] for dropdowns,
 * plus an optional free-text search and a created-date range.
 * Search is debounced so typing does not fire a request per keystroke.
 */
export default function FilterBar({
  value,
  onChange,
  fields = [],
  searchKey = 'search',
  searchPlaceholder = 'Search…',
  showSearch = true,
  showDateRange = true,
  extraSearchFields = [],
}) {
  const [searchDraft, setSearchDraft] = useState(value[searchKey] || '');
  const [extraDrafts, setExtraDrafts] = useState(() => (
    Object.fromEntries(extraSearchFields.map((f) => [f.key, value[f.key] || '']))
  ));
  const firstRun = useRef(true);

  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return undefined;
    }
    const id = setTimeout(() => {
      onChange({ ...value, [searchKey]: searchDraft, ...extraDrafts, page: 1 });
    }, 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft, extraDrafts]);

  const set = (patch) => onChange({ ...value, ...patch, page: 1 });

  const activeCount = [
    ...fields.map((f) => value[f.key]),
    value.date_from,
    value.date_to,
    value[searchKey],
    ...extraSearchFields.map((f) => value[f.key]),
  ].filter(Boolean).length;

  const clearAll = () => {
    setSearchDraft('');
    setExtraDrafts(Object.fromEntries(extraSearchFields.map((f) => [f.key, ''])));
    const cleared = { page: 1, limit: value.limit };
    fields.forEach((f) => { cleared[f.key] = ''; });
    cleared[searchKey] = '';
    extraSearchFields.forEach((f) => { cleared[f.key] = ''; });
    cleared.date_from = '';
    cleared.date_to = '';
    onChange(cleared);
  };

  return (
    <div className="bg-white border rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        {showSearch && (
          <label className="flex-1 min-w-[220px] block text-xs text-slate-500">
            Search
            <div className="relative mt-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder={searchPlaceholder}
                className={`${INPUT} w-full pl-9`}
              />
            </div>
          </label>
        )}

        {extraSearchFields.map((f) => (
          <label key={f.key} className="block text-xs text-slate-500 min-w-[150px]">
            {f.label}
            <input
              value={extraDrafts[f.key] ?? ''}
              onChange={(e) => setExtraDrafts((d) => ({ ...d, [f.key]: e.target.value }))}
              placeholder={f.placeholder || ''}
              className={`${INPUT} mt-1 w-full`}
            />
          </label>
        ))}

        {fields.map((f) => (
          <label key={f.key} className="block text-xs text-slate-500 min-w-[150px]">
            {f.label}
            <select
              value={value[f.key] || ''}
              onChange={(e) => set({ [f.key]: e.target.value })}
              className={`${INPUT} mt-1 w-full bg-white`}
            >
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
        ))}

        {showDateRange && (
          <>
            <label className="block text-xs text-slate-500">
              From
              <input
                type="date"
                value={value.date_from || ''}
                onChange={(e) => set({ date_from: e.target.value })}
                className={`${INPUT} mt-1 block`}
              />
            </label>
            <label className="block text-xs text-slate-500">
              To
              <input
                type="date"
                value={value.date_to || ''}
                onChange={(e) => set({ date_to: e.target.value })}
                className={`${INPUT} mt-1 block`}
              />
            </label>
          </>
        )}

        {activeCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1 px-3 py-2 text-sm text-slate-600 border rounded-lg hover:bg-slate-50"
          >
            <X className="w-4 h-4" />
            Clear ({activeCount})
          </button>
        )}
      </div>
    </div>
  );
}
