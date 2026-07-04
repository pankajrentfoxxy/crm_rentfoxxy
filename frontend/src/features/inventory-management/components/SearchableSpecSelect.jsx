import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';

export default function SearchableSpecSelect({
  label,
  value,
  onChange,
  options = [],
  placeholder = 'All',
  disabled = false,
  className = '',
}) {
  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const normalizedOptions = useMemo(
    () => (options || []).map((opt) => (typeof opt === 'string' ? opt : String(opt))),
    [options],
  );

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return normalizedOptions;
    return normalizedOptions.filter((opt) => opt.toLowerCase().includes(q));
  }, [normalizedOptions, search]);

  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => searchRef.current?.focus(), 40);
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDocClick);
    };
  }, [open]);

  const display = value || placeholder;

  return (
    <div ref={rootRef} className={`min-w-[92px] flex-1 max-w-[132px] ${className}`}>
      {label ? (
        <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-0.5 truncate">
          {label}
        </span>
      ) : null}
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => { if (!disabled) setOpen((o) => !o); }}
          className="w-full flex items-center justify-between gap-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs min-h-[32px] text-left disabled:opacity-50 hover:border-slate-300 focus:outline-none focus:ring-1 focus:ring-sky-500"
        >
          <span className={`truncate ${value ? 'text-slate-800' : 'text-slate-400'}`}>{display}</span>
          <ChevronDown className={`w-3 h-3 shrink-0 text-slate-400 ${open ? 'rotate-180' : ''}`} />
        </button>
        {open ? (
          <div className="absolute z-50 mt-0.5 w-[min(100%,220px)] rounded-md border border-slate-200 bg-white shadow-lg overflow-hidden">
            <div className="p-1.5 border-b border-slate-100">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400 pointer-events-none" />
                <input
                  ref={searchRef}
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search…"
                  className="w-full rounded border border-slate-200 pl-6 pr-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>
            </div>
            <ul role="listbox" className="max-h-40 overflow-y-auto py-0.5 text-xs">
              <li>
                <button
                  type="button"
                  role="option"
                  onClick={() => { onChange(''); setOpen(false); setSearch(''); }}
                  className={`w-full text-left px-2 py-1.5 hover:bg-sky-50 ${!value ? 'bg-sky-50 text-sky-800 font-medium' : 'text-slate-500'}`}
                >
                  {placeholder}
                </button>
              </li>
              {filteredOptions.length === 0 ? (
                <li className="px-2 py-2 text-center text-slate-400">No match</li>
              ) : (
                filteredOptions.map((opt) => (
                  <li key={opt}>
                    <button
                      type="button"
                      role="option"
                      onClick={() => { onChange(opt); setOpen(false); setSearch(''); }}
                      className={`w-full text-left px-2 py-1.5 hover:bg-sky-50 truncate ${
                        value === opt ? 'bg-sky-50 text-sky-800 font-medium' : 'text-slate-800'
                      }`}
                    >
                      {opt}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
