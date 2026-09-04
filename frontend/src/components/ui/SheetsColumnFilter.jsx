import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Filter } from 'lucide-react';
import { isColumnFilterActive } from '../../features/inventory-management/vendorMasterColumnFilters';

const NUM_OPS = [
  { value: 'between', label: 'Between' },
  { value: 'eq', label: 'Equals' },
  { value: 'gt', label: 'Greater than' },
  { value: 'gte', label: 'Greater or equal' },
  { value: 'lt', label: 'Less than' },
  { value: 'lte', label: 'Less or equal' },
];

function useOutsideClick(ref, onClose, enabled) {
  useEffect(() => {
    if (!enabled) return undefined;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, onClose, enabled]);
}

function TextFilterPanel({
  options,
  loading,
  draft,
  setDraft,
  onApply,
  onClear,
}) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => String(o).toLowerCase().includes(q));
  }, [options, search]);

  const toggle = (val) => {
    setDraft((prev) => {
      const set = new Set(prev);
      if (set.has(val)) set.delete(val);
      else set.add(val);
      return [...set];
    });
  };

  return (
    <div className="p-2 w-56">
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search…"
        className="w-full mb-2 px-2 py-1 text-xs border border-slate-200 rounded"
        autoFocus
      />
      <div className="flex gap-2 mb-2 text-[11px]">
        <button
          type="button"
          className="text-blue-600 hover:underline"
          onClick={() => setDraft([...filtered])}
        >
          Select all
        </button>
        <button
          type="button"
          className="text-slate-500 hover:underline"
          onClick={() => setDraft([])}
        >
          Clear all
        </button>
      </div>
      <div className="max-h-48 overflow-y-auto border border-slate-100 rounded mb-2">
        {loading ? (
          <p className="text-xs text-slate-400 p-2">Loading…</p>
        ) : filtered.length ? filtered.map((opt) => (
          <label
            key={opt}
            className="flex items-start gap-2 px-2 py-1 text-xs hover:bg-slate-50 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={draft.includes(opt)}
              onChange={() => toggle(opt)}
              className="mt-0.5 shrink-0"
            />
            <span className="break-all leading-snug">{opt}</span>
          </label>
        )) : (
          <p className="text-xs text-slate-400 p-2">No values</p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClear} className="text-xs px-2 py-1 text-slate-600 hover:bg-slate-50 rounded">
          Clear filter
        </button>
        <button type="button" onClick={onApply} className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">
          Apply
        </button>
      </div>
    </div>
  );
}

function DateFilterPanel({ draft, setDraft, onApply, onClear }) {
  return (
    <div className="p-2 w-52 space-y-2">
      <label className="block text-[11px] text-slate-500">
        From
        <input
          type="date"
          value={draft.from || ''}
          onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value || null }))}
          className="mt-0.5 w-full px-2 py-1 text-xs border border-slate-200 rounded"
        />
      </label>
      <label className="block text-[11px] text-slate-500">
        To
        <input
          type="date"
          value={draft.to || ''}
          onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value || null }))}
          className="mt-0.5 w-full px-2 py-1 text-xs border border-slate-200 rounded"
        />
      </label>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClear} className="text-xs px-2 py-1 text-slate-600 hover:bg-slate-50 rounded">
          Clear filter
        </button>
        <button type="button" onClick={onApply} className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">
          Apply
        </button>
      </div>
    </div>
  );
}

function NumberFilterPanel({ draft, setDraft, onApply, onClear }) {
  return (
    <div className="p-2 w-52 space-y-2">
      <label className="block text-[11px] text-slate-500">
        Condition
        <select
          value={draft.op || 'between'}
          onChange={(e) => setDraft((d) => ({ ...d, op: e.target.value }))}
          className="mt-0.5 w-full px-2 py-1 text-xs border border-slate-200 rounded"
        >
          {NUM_OPS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      {draft.op === 'eq' ? (
        <label className="block text-[11px] text-slate-500">
          Value
          <input
            type="number"
            value={draft.eq ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, eq: e.target.value === '' ? null : Number(e.target.value) }))}
            className="mt-0.5 w-full px-2 py-1 text-xs border border-slate-200 rounded"
          />
        </label>
      ) : (
        <>
          {(draft.op === 'between' || draft.op === 'gt' || draft.op === 'gte') ? (
            <label className="block text-[11px] text-slate-500">
              {draft.op === 'between' ? 'Min' : 'Value'}
              <input
                type="number"
                value={draft.min ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, min: e.target.value === '' ? null : Number(e.target.value) }))}
                className="mt-0.5 w-full px-2 py-1 text-xs border border-slate-200 rounded"
              />
            </label>
          ) : null}
          {(draft.op === 'between' || draft.op === 'lt' || draft.op === 'lte') ? (
            <label className="block text-[11px] text-slate-500">
              {draft.op === 'between' ? 'Max' : 'Value'}
              <input
                type="number"
                value={draft.max ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, max: e.target.value === '' ? null : Number(e.target.value) }))}
                className="mt-0.5 w-full px-2 py-1 text-xs border border-slate-200 rounded"
              />
            </label>
          ) : null}
        </>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClear} className="text-xs px-2 py-1 text-slate-600 hover:bg-slate-50 rounded">
          Clear filter
        </button>
        <button type="button" onClick={onApply} className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">
          Apply
        </button>
      </div>
    </div>
  );
}

/**
 * Google Sheets-style column header filter trigger + dropdown.
 */
export default function SheetsColumnFilter({
  label,
  columnKey,
  filterType = 'text',
  align = 'left',
  activeFilter,
  onApplyFilter,
  onClearFilter,
  fetchOptions,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const active = isColumnFilterActive(activeFilter);

  const [options, setOptions] = useState([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [textDraft, setTextDraft] = useState([]);
  const [dateDraft, setDateDraft] = useState({ from: null, to: null });
  const [numDraft, setNumDraft] = useState({ op: 'between', min: null, max: null, eq: null });

  const close = useCallback(() => setOpen(false), []);

  useOutsideClick(rootRef, close, open);

  useEffect(() => {
    if (!open) return;
    if (filterType === 'text') {
      setTextDraft(activeFilter?.type === 'text' ? [...activeFilter.values] : []);
      setLoadingOptions(true);
      fetchOptions(columnKey)
        .then((vals) => setOptions(vals || []))
        .catch(() => setOptions([]))
        .finally(() => setLoadingOptions(false));
    } else if (filterType === 'date') {
      setDateDraft(activeFilter?.type === 'date'
        ? { from: activeFilter.from, to: activeFilter.to }
        : { from: null, to: null });
    } else if (filterType === 'number') {
      setNumDraft(activeFilter?.type === 'number'
        ? { ...activeFilter }
        : { op: 'between', min: null, max: null, eq: null });
    }
  }, [open, columnKey, filterType, activeFilter, fetchOptions]);

  const handleApply = () => {
    if (filterType === 'text') {
      onApplyFilter(columnKey, textDraft.length ? { type: 'text', values: textDraft } : null);
    } else if (filterType === 'date') {
      const has = dateDraft.from || dateDraft.to;
      onApplyFilter(columnKey, has ? { type: 'date', ...dateDraft } : null);
    } else if (filterType === 'number') {
      onApplyFilter(columnKey, numDraft.op === 'eq' && numDraft.eq != null
        ? { type: 'number', op: 'eq', eq: numDraft.eq }
        : (numDraft.min != null || numDraft.max != null)
          ? { type: 'number', ...numDraft }
          : null);
    }
    close();
  };

  const handleClear = () => {
    onClearFilter(columnKey);
    close();
  };

  return (
    <th
      className={`px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'} ${className}`.trim()}
    >
      <div ref={rootRef} className={`relative inline-flex items-center gap-1 max-w-full ${align === 'right' ? 'justify-end' : ''}`}>
        <span className="truncate">{label}</span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
          className={`shrink-0 p-0.5 rounded hover:bg-slate-200/80 ${active ? 'text-blue-600' : 'text-slate-400'}`}
          title={active ? 'Filter active' : 'Filter'}
          aria-label={`Filter ${label}`}
        >
          <Filter className="w-3 h-3" strokeWidth={active ? 2.5 : 2} />
        </button>
        {open ? (
          <div
            className={`fixed z-[200] mt-0 bg-white border border-slate-200 rounded-lg shadow-lg normal-case font-normal tracking-normal ${
              align === 'right' ? '' : ''
            }`}
            style={{
              top: rootRef.current?.getBoundingClientRect().bottom ?? 0,
              left: align === 'right'
                ? (rootRef.current?.getBoundingClientRect().right ?? 0) - 224
                : (rootRef.current?.getBoundingClientRect().left ?? 0),
              minWidth: filterType === 'number' ? '13rem' : '14rem',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {filterType === 'text' ? (
              <TextFilterPanel
                options={options}
                loading={loadingOptions}
                draft={textDraft}
                setDraft={setTextDraft}
                onApply={handleApply}
                onClear={handleClear}
              />
            ) : null}
            {filterType === 'date' ? (
              <DateFilterPanel
                draft={dateDraft}
                setDraft={setDateDraft}
                onApply={handleApply}
                onClear={handleClear}
              />
            ) : null}
            {filterType === 'number' ? (
              <NumberFilterPanel
                draft={numDraft}
                setDraft={setNumDraft}
                onApply={handleApply}
                onClear={handleClear}
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </th>
  );
}
