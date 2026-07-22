import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';

function normalizeOptions(options = []) {
  return (options || []).map((opt) => {
    if (opt != null && typeof opt === 'object' && !Array.isArray(opt)) {
      const value = opt.value != null ? String(opt.value) : '';
      const label = opt.label != null ? String(opt.label) : value;
      return { value, label };
    }
    const s = String(opt);
    return { value: s, label: s };
  });
}

export default function SearchableSelect({
  label,
  required = false,
  value,
  onChange,
  options = [],
  placeholder = 'Please Select',
  disabled = false,
  id,
}) {
  const rootRef = useRef(null);
  const searchRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const normalizedOptions = useMemo(() => normalizeOptions(options), [options]);

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return normalizedOptions;
    return normalizedOptions.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q)
        || opt.value.toLowerCase().includes(q)
    );
  }, [normalizedOptions, search]);

  const selected = useMemo(
    () => normalizedOptions.find((opt) => String(opt.value) === String(value ?? '')),
    [normalizedOptions, value]
  );

  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => searchRef.current?.focus(), 50);
    function onDocClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDocClick);
    };
  }, [open]);

  const displayValue = selected?.label || placeholder;

  return (
    <div ref={rootRef}>
      {label ? (
        <label htmlFor={id} className="block text-xs font-medium text-gray-600 mb-1">
          {label}
          {required ? <span className="text-red-500 ml-0.5">*</span> : null}
        </label>
      ) : null}
      <div className="relative">
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => {
            if (disabled) return;
            setOpen((prev) => !prev);
          }}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white text-left disabled:opacity-60 hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-600"
        >
          <span className={selected ? 'text-gray-900 truncate' : 'text-gray-400 truncate'}>{displayValue}</span>
          <ChevronDown className={`w-4 h-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open ? (
          <div className="absolute z-30 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg overflow-hidden">
            <div className="p-2 border-b border-gray-100">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input
                  ref={searchRef}
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search..."
                  className="w-full rounded-md border border-gray-200 pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-600"
                />
              </div>
            </div>
            <ul role="listbox" className="max-h-48 overflow-y-auto py-1 text-sm">
              {!required ? (
                <li>
                  <button
                    type="button"
                    role="option"
                    aria-selected={!value}
                    onClick={() => {
                      onChange('');
                      setOpen(false);
                      setSearch('');
                    }}
                    className={`w-full text-left px-3 py-2 hover:bg-teal-50 ${!value ? 'bg-teal-50 text-teal-900 font-medium' : 'text-gray-500'}`}
                  >
                    {placeholder}
                  </button>
                </li>
              ) : null}
              {filteredOptions.length === 0 ? (
                <li className="px-3 py-4 text-center text-gray-500 text-xs">No options match your search.</li>
              ) : (
                filteredOptions.map((opt) => {
                  const isSelected = String(value ?? '') === String(opt.value);
                  return (
                    <li key={opt.value}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => {
                          onChange(opt.value);
                          setOpen(false);
                          setSearch('');
                        }}
                        className={`w-full text-left px-3 py-2 hover:bg-teal-50 ${
                          isSelected ? 'bg-teal-50 text-teal-900 font-medium' : 'text-gray-800'
                        }`}
                      >
                        {opt.label}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        ) : null}
      </div>
      {required ? (
        <select
          tabIndex={-1}
          aria-hidden
          className="sr-only"
          value={value ?? ''}
          onChange={() => {}}
          required
        >
          <option value="">Please Select</option>
          {normalizedOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
