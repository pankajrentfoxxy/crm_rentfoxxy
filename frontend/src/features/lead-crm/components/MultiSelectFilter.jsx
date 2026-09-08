import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

function normalizeOptions(options) {
  return (options || []).map((opt) => {
    if (typeof opt === 'string') return { value: opt, label: opt };
    return { value: String(opt.value), label: String(opt.label ?? opt.value) };
  });
}

export default function MultiSelectFilter({
  options = [],
  value = [],
  onChange,
  allLabel,
  className = '',
}) {
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState(null);

  const normalizedOptions = useMemo(() => normalizeOptions(options), [options]);
  const optionMap = useMemo(
    () => new Map(normalizedOptions.map((opt) => [opt.value, opt.label])),
    [normalizedOptions],
  );

  const selectedValues = useMemo(
    () => (Array.isArray(value) ? value.map(String) : []),
    [value],
  );

  const displayText = selectedValues.length === 0 || selectedValues.length >= normalizedOptions.length
    ? allLabel
    : selectedValues.length === 1
      ? optionMap.get(selectedValues[0]) || selectedValues[0]
      : `${selectedValues.length} selected`;

  const allChecked = selectedValues.length === normalizedOptions.length;
  const someChecked = selectedValues.length > 0 && selectedValues.length < normalizedOptions.length;

  const updateMenuPosition = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const viewportPadding = 8;
    const maxMenuHeight = 240;
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;
    const openUpward = spaceBelow < 180 && spaceAbove > spaceBelow;
    const availableHeight = openUpward ? spaceAbove : spaceBelow;
    const menuHeight = Math.min(maxMenuHeight, Math.max(availableHeight, 120));

    setMenuStyle({
      position: 'fixed',
      left: rect.left,
      width: Math.max(rect.width, 180),
      zIndex: 9999,
      maxHeight: menuHeight,
      ...(openUpward
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
    });
  };

  useEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return undefined;
    }
    updateMenuPosition();
    function onDocClick(e) {
      if (rootRef.current?.contains(e.target)) return;
      const menu = document.getElementById(menuId);
      if (menu?.contains(e.target)) return;
      setOpen(false);
    }
    function onReposition() {
      updateMenuPosition();
    }
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
    };
  }, [open, menuId]);

  const menu = open && menuStyle ? (
    <div
      id={menuId}
      style={menuStyle}
      className="bg-white border border-gray-200 rounded-lg shadow-lg py-1 overflow-y-auto"
    >
      <label className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer font-medium">
        <input
          type="checkbox"
          checked={allChecked}
          ref={(el) => {
            if (el) el.indeterminate = someChecked;
          }}
          onChange={(e) => {
            onChange(e.target.checked ? normalizedOptions.map((opt) => opt.value) : []);
          }}
          className="rounded"
        />
        <span>All</span>
      </label>
      {normalizedOptions.map((option) => (
        <label key={option.value} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
          <input
            type="checkbox"
            checked={selectedValues.includes(option.value)}
            onChange={(e) => {
              if (e.target.checked) {
                onChange([...new Set([...selectedValues, option.value])]);
              } else {
                onChange(selectedValues.filter((x) => x !== option.value));
              }
            }}
            className="rounded"
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  ) : null;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-left flex items-center justify-between gap-2 bg-white hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
      >
        <span className="truncate">{displayText}</span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {menu && typeof document !== 'undefined' ? createPortal(menu, document.body) : null}
    </div>
  );
}
