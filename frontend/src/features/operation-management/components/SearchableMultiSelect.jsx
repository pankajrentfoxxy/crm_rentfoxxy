import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, X } from 'lucide-react';

function normalizeOptions(options) {
  return (options || []).map((opt) => {
    if (typeof opt === 'string') {
      return { value: opt, label: opt };
    }
    const value = opt.value ?? opt.picker_value ?? opt.formatted_serial ?? '';
    const label = opt.label ?? value;
    return { value: String(value), label: String(label) };
  }).filter((opt) => opt.value);
}

export default function SearchableMultiSelect({
  label,
  required = false,
  value = [],
  onChange,
  options = [],
  placeholder = 'Please Select',
  disabled = false,
  id,
  maxSelections,
  emptyMessage = 'No options available.',
  countNoun = 'item',
}) {
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const searchRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [menuStyle, setMenuStyle] = useState(null);

  const normalizedOptions = useMemo(() => normalizeOptions(options), [options]);
  const selectedValues = useMemo(
    () => (Array.isArray(value) ? value.map(String) : []),
    [value]
  );

  const optionMap = useMemo(() => {
    const map = new Map();
    normalizedOptions.forEach((opt) => map.set(opt.value, opt.label));
    return map;
  }, [normalizedOptions]);

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return normalizedOptions;
    return normalizedOptions.filter(
      (opt) => opt.label.toLowerCase().includes(q) || opt.value.toLowerCase().includes(q)
    );
  }, [normalizedOptions, search]);

  const atMax =
    maxSelections != null && Number.isFinite(Number(maxSelections)) && selectedValues.length >= Number(maxSelections);

  const updateMenuPosition = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const viewportPadding = 8;
    const maxMenuHeight = 280;
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;
    const openUpward = spaceBelow < 180 && spaceAbove > spaceBelow;
    const availableHeight = openUpward ? spaceAbove : spaceBelow;
    const menuHeight = Math.min(maxMenuHeight, Math.max(availableHeight, 160));

    setMenuStyle({
      position: 'fixed',
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
      maxHeight: menuHeight,
      ...(openUpward
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
    });
  };

  useEffect(() => {
    if (!open) return undefined;
    updateMenuPosition();
    const t = setTimeout(() => searchRef.current?.focus(), 50);
    function onDocClick(e) {
      if (rootRef.current?.contains(e.target)) return;
      const menu = document.getElementById(`${id || 'multi-select'}-menu`);
      if (menu?.contains(e.target)) return;
      setOpen(false);
      setSearch('');
    }
    function onReposition() {
      updateMenuPosition();
    }
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
    };
  }, [open, id]);

  const toggleValue = (optValue) => {
    const v = String(optValue);
    if (selectedValues.includes(v)) {
      onChange(selectedValues.filter((x) => x !== v));
      return;
    }
    if (atMax) return;
    onChange([...selectedValues, v]);
  };

  const removeValue = (optValue, e) => {
    e?.stopPropagation();
    onChange(selectedValues.filter((x) => x !== String(optValue)));
  };

  const triggerText =
    selectedValues.length === 0
      ? placeholder
      : `${selectedValues.length} ${countNoun}${selectedValues.length === 1 ? '' : 's'} selected`;

  const menu = open && menuStyle ? (
    <div
      id={`${id || 'multi-select'}-menu`}
      style={menuStyle}
      className="flex flex-col rounded-lg border border-gray-200 bg-white shadow-lg overflow-hidden"
    >
      <div className="shrink-0 p-2 border-b border-gray-100">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            ref={searchRef}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search serial number..."
            className="w-full rounded-md border border-gray-200 pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-600"
          />
        </div>
      </div>
      <ul role="listbox" aria-multiselectable="true" className="flex-1 min-h-0 overflow-y-auto py-1 text-sm">
        {filteredOptions.length === 0 ? (
          <li className="px-3 py-4 text-center text-gray-500 text-xs">{emptyMessage}</li>
        ) : (
          filteredOptions.map((opt) => {
            const checked = selectedValues.includes(opt.value);
            const optionDisabled = !checked && atMax;
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={checked}
                  disabled={optionDisabled}
                  onClick={() => toggleValue(opt.value)}
                  className={`w-full flex items-start gap-2.5 text-left px-3 py-2.5 hover:bg-teal-50 disabled:opacity-50 disabled:cursor-not-allowed ${
                    checked ? 'bg-teal-50 text-teal-900' : 'text-gray-800'
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] leading-none ${
                      checked ? 'border-teal-600 bg-teal-600 text-white' : 'border-gray-300 bg-white'
                    }`}
                    aria-hidden
                  >
                    {checked ? '✓' : ''}
                  </span>
                  <span className="truncate">{opt.label}</span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  ) : null;

  return (
    <div ref={rootRef} className="relative">
      {label ? (
        <label htmlFor={id} className="block text-xs font-medium text-gray-600 mb-1">
          {label}
          {required ? <span className="text-red-500 ml-0.5">*</span> : null}
        </label>
      ) : null}

      {selectedValues.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {selectedValues.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 max-w-full px-2 py-1 rounded-md bg-teal-50 border border-teal-200 text-xs text-teal-900"
            >
              <span className="truncate">{optionMap.get(v) || v}</span>
              {!disabled ? (
                <button
                  type="button"
                  onClick={(e) => removeValue(v, e)}
                  className="shrink-0 text-teal-700 hover:text-teal-900"
                  aria-label={`Remove ${optionMap.get(v) || v}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      <button
        ref={triggerRef}
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => !prev);
        }}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 border border-gray-200 rounded-lg text-sm bg-white text-left disabled:opacity-60 hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-teal-600/20 focus:border-teal-600 min-h-[42px]"
      >
        <span className={selectedValues.length ? 'text-gray-900 truncate' : 'text-gray-400 truncate'}>
          {triggerText}
        </span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {menu && typeof document !== 'undefined' ? createPortal(menu, document.body) : null}

      {required ? (
        <select
          tabIndex={-1}
          aria-hidden
          multiple
          required
          className="sr-only"
          value={selectedValues}
          onChange={() => {}}
        >
          {normalizedOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      ) : null}
    </div>
  );
}
