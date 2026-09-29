import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * A <Select> you can type into. Same props as Select — value, onChange(e),
 * options [{ value, label, disabled? } | string], placeholder — so a long list
 * (customers, vendors) becomes searchable by swapping the component name.
 *
 * Typing filters on every word in any order ("tech safar" finds "Safar Tech"),
 * across the label and an optional `search` string per option (GSTIN, phone).
 * Arrow keys move, Enter picks, Esc closes; the list shows the first 100
 * matches so a 5,000-row list stays quick.
 *
 * The list is portalled to <body> with fixed positioning: cards clip their
 * content (overflow:hidden), which cut an in-card list down to one row.
 */
const LIMIT = 100;
const norm = (s) => String(s ?? '').toLowerCase();

export default function SearchSelect({
  options = [], value, onChange, placeholder = 'Choose…', disabled, id, className = '', emptyText = 'Nothing matches',
  'aria-label': ariaLabel, 'aria-invalid': ariaInvalid, 'aria-describedby': ariaDescribedBy,
}) {
  const autoId = useId();
  const listId = `${id || autoId}-list`;
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState(null);

  const items = useMemo(() => options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o)), [options]);
  const selected = items.find((o) => String(o.value) === String(value ?? '')) || null;

  const matches = useMemo(() => {
    const words = norm(query).split(/\s+/).filter(Boolean);
    const hit = words.length
      ? items.filter((o) => { const hay = `${norm(o.label)} ${norm(o.search)}`; return words.every((w) => hay.includes(w)); })
      : items;
    return hit.slice(0, LIMIT);
  }, [items, query]);

  useEffect(() => { setActive(0); }, [query, open]);

  // Follow the input while the page scrolls or resizes.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom - 8;
      const up = below < 200 && r.top > below;
      setRect({ left: r.left, width: r.width, top: r.bottom + 2, bottom: window.innerHeight - r.top + 2, up, max: Math.min(320, (up ? r.top : below) - 8) });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [open]);

  // Close on a click anywhere else.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target) && !listRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Keep the highlighted row in view while arrowing.
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (o) => {
    if (!o || o.disabled) return;
    onChange?.({ target: { value: String(o.value) } });
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); else setActive((i) => Math.min(i + 1, matches.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { if (open) { e.preventDefault(); pick(matches[active]); } }
    else if (e.key === 'Escape') { if (open) { e.stopPropagation(); setOpen(false); setQuery(''); } }
    else if (e.key === 'Tab') { setOpen(false); setQuery(''); }
  };

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        autoComplete="off"
        disabled={disabled}
        className="c-input c-select-full"
        placeholder={selected ? selected.label : placeholder}
        value={open ? query : (selected ? selected.label : '')}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={onKeyDown}
      />
      {open && !disabled && rect && createPortal(
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          className="bg-surface border border-rule font-ui m-0"
          style={{
            position: 'fixed', left: rect.left, width: rect.width, zIndex: 1300, maxHeight: Math.max(rect.max, 120), overflowY: 'auto',
            ...(rect.up ? { bottom: rect.bottom } : { top: rect.top }),
            listStyle: 'none', padding: '4px 0', borderRadius: 'var(--d-radius)', boxShadow: 'var(--shadow-lg)',
          }}
        >
          {matches.length === 0 && <li className="text-ink-3" style={{ padding: '6px 10px', fontSize: 'var(--d-sm)' }}>{emptyText}</li>}
          {matches.map((o, i) => (
            <li
              key={String(o.value)}
              id={`${listId}-${i}`}
              data-idx={i}
              role="option"
              aria-selected={String(o.value) === String(value ?? '')}
              aria-disabled={o.disabled || undefined}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              onMouseEnter={() => setActive(i)}
              className={o.disabled ? 'text-ink-3' : 'text-ink'}
              style={{
                padding: '6px 10px', cursor: o.disabled ? 'not-allowed' : 'pointer', fontSize: 'var(--d-base)',
                background: i === active ? 'var(--surface-2)' : undefined,
                fontWeight: String(o.value) === String(value ?? '') ? 600 : undefined,
              }}
            >
              {o.label}
            </li>
          ))}
          {matches.length === LIMIT && (
            <li className="text-ink-3" style={{ padding: '6px 10px', fontSize: 'var(--d-sm)' }}>Showing the first {LIMIT} — type more to narrow down</li>
          )}
        </ul>,
        document.body,
      )}
    </div>
  );
}
