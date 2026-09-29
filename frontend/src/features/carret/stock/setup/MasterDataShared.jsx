import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Filter } from 'lucide-react';
import {
  Button, Checkbox, Drawer, EmptyState, Field, FormGrid, Input, Select,
} from '../../../../components/carret';
import useDebouncedValue from '../../../../hooks/useDebouncedValue';
import useInventorySpecFilterOptions from '../../../inventory-management/hooks/useInventorySpecFilterOptions';
import { SPEC_FILTER_KEYS, parseSpecMultiUrl } from '../../../inventory-management/inventorySpecFilters';

/**
 * Pieces shared by the three Master data reports (MasterDataPage.jsx):
 * URL-backed filter state, a multi-select, clickable KPI tiles, the
 * Sheets-style column filter (cf_* params) and the laptop spec filters.
 * Everything here is Carret-styled; the param encoding is the old pages' own
 * helper modules, so the backend sees exactly what it saw before.
 */

export const PAGE_SIZE = 25;

export function currentMonthValue() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);
}

function buildMonthOptions(count = 24) {
  const out = [];
  const anchor = new Date();
  anchor.setDate(1);
  for (let i = 0; i < count; i += 1) {
    const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1);
    out.push({
      value: d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7),
      label: d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }),
    });
  }
  return out;
}
export const MONTH_OPTIONS = buildMonthOptions();

export function formatMonthLabel(yyyyMm) {
  if (!/^\d{4}-\d{2}$/.test(yyyyMm || '')) return yyyyMm || '';
  return new Date(`${yyyyMm}-01T12:00:00+05:30`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

export const fmtMoney = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  return d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
}

export const humanize = (s) => String(s || '').replace(/_/g, ' ');

export function readCsv(sp, key) {
  return String(sp.get(key) || '').split(',').map((s) => s.trim()).filter(Boolean);
}

export const errMsg = (e, fallback = 'That did not work.') => e?.response?.data?.message || e?.message || fallback;

/**
 * Filter state lives in the URL so a drill-down survives reload and back.
 * `patch` writes only keys in `urlKeys` (plus page) and resets page unless told.
 */
export function useUrlFilters(urlKeys) {
  const [sp, setSp] = useSearchParams();
  const keysRef = useRef(urlKeys);
  const patch = useCallback((changes, { resetPage = true } = {}) => {
    setSp((prev) => {
      const next = new URLSearchParams(prev);
      const apply = { ...changes };
      if (resetPage && !Object.prototype.hasOwnProperty.call(apply, 'page')) apply.page = 1;
      Object.entries(apply).forEach(([k, v]) => {
        if (k !== 'page' && !keysRef.current.includes(k)) return;
        const val = Array.isArray(v) ? v.filter(Boolean).join(',') : v;
        if (val === '' || val == null || val === false || (k === 'page' && Number(val) <= 1)) next.delete(k);
        else if (val === true) next.set(k, '1');
        else next.set(k, String(val));
      });
      return next;
    }, { replace: true });
  }, [setSp]);
  return { sp, setSp, patch };
}

/** Search box whose debounced value is written to `q`. */
export function useSearchBox(sp, patch) {
  const q = sp.get('q') || '';
  const [input, setInput] = useState(q);
  const debounced = useDebouncedValue(input.trim(), 350);
  useEffect(() => {
    if (debounced !== (sp.get('q') || '')) patch({ q: debounced });
  }, [debounced]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setInput((prev) => (prev.trim() === q ? prev : q)); }, [q]);
  return [input, setInput];
}

/** Latest-request-wins loader: returns [data, loading, reload]. */
export function useLoader(fn, deps) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const req = useRef(0);
  const run = useCallback(() => {
    const id = ++req.current;
    setState((s) => ({ ...s, loading: true }));
    fn()
      .then((data) => { if (id === req.current) setState({ data, loading: false, error: null }); })
      .catch((e) => { if (id === req.current) setState((s) => ({ data: s.data, loading: false, error: errMsg(e) })); });
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, [run]);
  return [state.data, state.loading, run, state.error];
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: Math.min(r.left, window.innerWidth - 300) });
    }
    setOpen((o) => !o);
  };
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onScroll = (e) => { if (!panelRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);
  return { open, setOpen, pos, toggle, btnRef, panelRef };
}

const popStyle = (pos) => ({
  position: 'fixed',
  top: pos?.top ?? 0,
  left: Math.max(8, pos?.left ?? 0),
  zIndex: 60,
  width: '18rem',
  maxHeight: '22rem',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--surface)',
  border: '1px solid var(--rule-2)',
  borderRadius: 'var(--d-radius)',
  boxShadow: 'var(--shadow-lg)',
  padding: '8px',
  gap: '6px',
});

/**
 * Pick several values from a list. options: [{ value, label } | string].
 * The button reads "Label: All" / the one value / "N chosen".
 */
export function MultiSelect({ label, options = [], value = [], onChange, allLabel = 'All' }) {
  const { open, pos, toggle, btnRef, panelRef } = usePopover();
  const [q, setQ] = useState('');
  const items = useMemo(() => options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o)), [options]);
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return words.length ? items.filter((o) => words.every((w) => String(o.label).toLowerCase().includes(w))) : items;
  }, [items, q]);
  const set = new Set(value.map(String));
  const summary = !value.length ? allLabel
    : value.length === 1 ? (items.find((o) => String(o.value) === String(value[0]))?.label || value[0])
      : `${value.length} chosen`;
  const flip = (v) => {
    const next = new Set(set);
    if (next.has(String(v))) next.delete(String(v)); else next.add(String(v));
    onChange?.([...next]);
  };
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`c-select ${value.length ? 'is-set' : ''}`}
        onClick={toggle}
        aria-expanded={open}
        style={{ textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
      >
        {label}: {summary}
      </button>
      {open && (
        <div ref={panelRef} role="dialog" aria-label={label} style={popStyle(pos)}>
          {items.length > 8 && (
            <Input type="search" placeholder={`Search ${label.toLowerCase()}`} value={q} onChange={(e) => setQ(e.target.value)} />
          )}
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {shown.map((o) => (
              <Checkbox key={o.value} label={o.label} checked={set.has(String(o.value))} onChange={() => flip(o.value)} />
            ))}
            {!shown.length && <p className="text-ink-3" style={{ padding: '6px' }}>Nothing matches</p>}
          </div>
          {value.length > 0 && <Button variant="quiet" onClick={() => onChange?.([])}>Clear {label.toLowerCase()}</Button>}
        </div>
      )}
    </>
  );
}

/** A KPI tile that drills the list down when clicked. */
export function ClickTile({ label, value, hint, onClick, active, family }) {
  const body = (
    <>
      <span className="text-ink-3 font-ui" style={{ fontSize: '13px', fontWeight: 500, display: 'block' }}>{label}</span>
      <span
        className="font-ui tabular-nums"
        style={{ display: 'block', fontSize: '24px', fontWeight: 600, lineHeight: 1.2, marginTop: '4px', color: family ? `var(--lc-${family})` : 'var(--ink)' }}
      >
        {value ?? '—'}
      </span>
      {hint && <span className="text-ink-3 font-ui" style={{ display: 'block', fontSize: 'var(--d-sm)', marginTop: '4px' }}>{hint}</span>}
    </>
  );
  const style = {
    padding: '12px 14px',
    textAlign: 'left',
    width: '100%',
    borderColor: active ? 'var(--accent)' : undefined,
    background: active ? 'var(--accent-soft)' : undefined,
  };
  if (!onClick) return <div className="c-card" style={style}>{body}</div>;
  return (
    <button type="button" className="c-card" style={{ ...style, cursor: 'pointer', font: 'inherit' }} onClick={onClick} aria-pressed={Boolean(active)}>
      {body}
    </button>
  );
}

export function TileGrid({ children, min = '11rem' }) {
  return <div style={{ display: 'grid', gap: '10px', gridTemplateColumns: `repeat(auto-fit, minmax(${min}, 1fr))` }}>{children}</div>;
}

/** Column header with a filter button (opens ColumnFilterDrawer). */
export function ColumnHeader({ label, colKey, active, onOpen }) {
  return (
    <span className="inline-flex items-center" style={{ gap: '4px' }}>
      {label}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onOpen(colKey); }}
        aria-label={`Filter ${label}`}
        title={active ? 'Filter on' : 'Filter'}
        style={{
          background: active ? 'var(--accent-soft)' : 'none',
          border: 0,
          padding: '2px',
          borderRadius: 'var(--d-radius)',
          cursor: 'pointer',
          color: active ? 'var(--accent)' : 'var(--ink-3)',
        }}
      >
        <Filter size={12} strokeWidth={active ? 2.6 : 2} />
      </button>
    </span>
  );
}

const NUMBER_OPS = [
  { value: 'between', label: 'Between' },
  { value: 'eq', label: 'Equal to' },
  { value: 'gt', label: 'Greater than' },
  { value: 'gte', label: 'At least' },
  { value: 'lt', label: 'Less than' },
  { value: 'lte', label: 'At most' },
];

/**
 * Sheets-style filter for one column. type text → tick values (from the
 * API's column-values endpoint, which already honours the other filters);
 * date → from/to; number → operator + value(s). onApply(filter|null).
 */
export function ColumnFilterDrawer({ column, type, current, fetchValues, onApply, onClose }) {
  const [values, setValues] = useState(null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState([]);
  const [date, setDate] = useState({ from: '', to: '' });
  const [num, setNum] = useState({ op: 'between', min: '', max: '', eq: '' });

  useEffect(() => {
    if (!column) return;
    setQ('');
    if (type === 'text') {
      setPicked(current?.type === 'text' ? [...current.values] : []);
      setValues(null);
      fetchValues(column.key).then((v) => setValues(v || [])).catch(() => setValues([]));
    } else if (type === 'date') {
      setDate({ from: current?.from || '', to: current?.to || '' });
    } else {
      setNum({
        op: current?.op || 'between',
        min: current?.min ?? '',
        max: current?.max ?? '',
        eq: current?.eq ?? '',
      });
    }
  }, [column, type]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    const list = (values || []).map(String);
    const needle = q.trim().toLowerCase();
    return needle ? list.filter((v) => v.toLowerCase().includes(needle)) : list;
  }, [values, q]);

  const apply = () => {
    if (type === 'text') onApply(picked.length ? { type: 'text', values: picked } : null);
    else if (type === 'date') onApply(date.from || date.to ? { type: 'date', from: date.from || null, to: date.to || null } : null);
    else {
      const n = (v) => (v === '' || v == null ? null : Number(v));
      if (num.op === 'eq') onApply(n(num.eq) != null ? { type: 'number', op: 'eq', eq: n(num.eq) } : null);
      else if (n(num.min) != null || n(num.max) != null) {
        onApply({ type: 'number', op: num.op, min: ['between', 'gt', 'gte'].includes(num.op) ? n(num.min) : null, max: ['between', 'lt', 'lte'].includes(num.op) ? n(num.max) : null });
      } else onApply(null);
    }
  };

  const flip = (v) => setPicked((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));

  return (
    <Drawer
      open={Boolean(column)}
      onClose={onClose}
      title={`Filter: ${column?.label || ''}`}
      width="26rem"
      footer={(
        <div className="flex" style={{ gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="quiet" onClick={() => onApply(null)}>Clear filter</Button>
          <Button variant="primary" onClick={apply}>Apply</Button>
        </div>
      )}
    >
      {column && type === 'text' && (
        <div className="c-stack">
          <Input type="search" placeholder="Search values" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="flex" style={{ gap: '8px' }}>
            <Button variant="quiet" onClick={() => setPicked([...new Set([...picked, ...shown])])}>Select shown</Button>
            <Button variant="quiet" onClick={() => setPicked([])}>Untick all</Button>
            <span className="text-ink-3" style={{ marginLeft: 'auto', alignSelf: 'center' }}>{picked.length} ticked</span>
          </div>
          {values === null ? <EmptyState title="Loading…" /> : (
            <div>
              {shown.map((v) => <Checkbox key={v} label={v || '(blank)'} checked={picked.includes(v)} onChange={() => flip(v)} />)}
              {!shown.length && <p className="text-ink-3">No values</p>}
            </div>
          )}
        </div>
      )}
      {column && type === 'date' && (
        <FormGrid cols={2}>
          <Field label="From"><Input type="date" value={date.from} max={date.to || undefined} onChange={(e) => setDate({ ...date, from: e.target.value })} /></Field>
          <Field label="To"><Input type="date" value={date.to} min={date.from || undefined} onChange={(e) => setDate({ ...date, to: e.target.value })} /></Field>
        </FormGrid>
      )}
      {column && type === 'number' && (
        <div className="c-stack">
          <Field label="Condition"><Select value={num.op} onChange={(e) => setNum({ ...num, op: e.target.value })} options={NUMBER_OPS} /></Field>
          {num.op === 'eq' && <Field label="Value"><Input type="number" value={num.eq} onChange={(e) => setNum({ ...num, eq: e.target.value })} /></Field>}
          {['between', 'gt', 'gte'].includes(num.op) && <Field label={num.op === 'between' ? 'Min' : 'Value'}><Input type="number" value={num.min} onChange={(e) => setNum({ ...num, min: e.target.value })} /></Field>}
          {['between', 'lt', 'lte'].includes(num.op) && <Field label={num.op === 'between' ? 'Max' : 'Value'}><Input type="number" value={num.max} onChange={(e) => setNum({ ...num, max: e.target.value })} /></Field>}
        </div>
      )}
    </Drawer>
  );
}

/**
 * Column filters in the URL (cf_* params), encoded by the report's own helper
 * module ({ read, toParams, clear }). Returns state, params and handlers.
 */
export function useColumnFilters(sp, setSp, helpers) {
  const key = sp.toString();
  const filters = useMemo(() => helpers.read(sp), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const params = useMemo(() => helpers.toParams(filters), [filters]); // eslint-disable-line react-hooks/exhaustive-deps
  const [openCol, setOpenCol] = useState(null);
  const apply = useCallback((colKey, filter) => {
    setSp((prev) => {
      const next = helpers.clear(prev);
      const merged = { ...helpers.read(prev) };
      if (filter) merged[colKey] = filter; else delete merged[colKey];
      Object.entries(helpers.toParams(merged)).forEach(([k, v]) => next.set(k, v));
      next.delete('page');
      return next;
    }, { replace: true });
  }, [setSp, helpers]);
  const clearAll = useCallback(() => {
    setSp((prev) => { const next = helpers.clear(prev); next.delete('page'); return next; }, { replace: true });
  }, [setSp, helpers]);
  return { filters, params, openCol, setOpenCol, apply, clearAll, count: Object.keys(filters).length };
}

/** Wrap column defs so each filterable one gets a ColumnHeader. */
export function withColumnFilters(columns, types, cf) {
  return columns.map((c) => (types[c.filterKey || c.key]
    ? {
      ...c,
      header: (
        <ColumnHeader
          label={c.header}
          colKey={c.filterKey || c.key}
          active={Boolean(cf.filters[c.filterKey || c.key])}
          onOpen={(k) => cf.setOpenCol({ key: k, label: c.header })}
        />
      ),
    }
    : c));
}

const SPEC_FIELDS = [
  { key: 'brand', label: 'Brand', optionsKey: 'brands' },
  { key: 'model', label: 'Model', optionsKey: 'models' },
  { key: 'processor', label: 'Processor', optionsKey: 'processors' },
  { key: 'generation', label: 'Gen', optionsKey: 'generations' },
  { key: 'ram', label: 'RAM', optionsKey: 'rams' },
  { key: 'storage', label: 'SSD', optionsKey: 'storages' },
  { key: 'screen_size', label: 'Screen', optionsKey: 'screen_sizes' },
  { key: 'gpu', label: 'GPU', optionsKey: 'gpus' },
];

/** Laptop spec filters (brand-scoped model / processor / generation), values in the URL. */
export function SpecFilters({ sp, patch }) {
  const brand = sp.get('brand') || '';
  const { options } = useInventorySpecFilterOptions(brand, true);
  const set = (key, vals) => {
    if (key === 'brand') patch({ brand: vals, model: '', processor: '', generation: '' });
    else patch({ [key]: vals });
  };
  const any = SPEC_FILTER_KEYS.some((k) => sp.get(k));
  return (
    <div className="flex flex-wrap items-center" style={{ gap: '8px' }}>
      {SPEC_FIELDS.map((f) => (
        <MultiSelect
          key={f.key}
          label={f.label}
          options={options[f.optionsKey] || []}
          value={parseSpecMultiUrl(sp.get(f.key))}
          onChange={(v) => set(f.key, v)}
        />
      ))}
      {any && <Button variant="quiet" onClick={() => patch(Object.fromEntries(SPEC_FILTER_KEYS.map((k) => [k, ''])))}>Clear specs</Button>}
    </div>
  );
}

/** Debounced spec params from the URL (the API reads brand/model/… as CSV). */
export function useSpecParams(sp) {
  const raw = SPEC_FILTER_KEYS.map((k) => sp.get(k) || '').join('|');
  const debounced = useDebouncedValue(raw, 320);
  return useMemo(() => {
    const parts = debounced.split('|');
    const out = {};
    SPEC_FILTER_KEYS.forEach((k, i) => { if (parts[i]) out[k] = parts[i]; });
    return out;
  }, [debounced]);
}

/**
 * All time / by month / date range. `allValue` is what "All time" is stored
 * as ('' for the laptop and return reports, 'all' for vendor purchase date).
 */
export function DateModeControl({ label, mode, months, from, to, onChange, allValue = '' }) {
  return (
    <div className="flex flex-wrap items-center" style={{ gap: '6px' }}>
      <select
        className={`c-select ${mode && mode !== allValue ? 'is-set' : ''}`}
        value={mode || allValue}
        aria-label={`${label} filter`}
        onChange={(e) => onChange({ mode: e.target.value })}
      >
        <option value={allValue}>{label}: All time</option>
        <option value="month">{label}: By month</option>
        <option value="range">{label}: Date range</option>
      </select>
      {mode === 'month' && (
        <MultiSelect
          label="Month"
          options={MONTH_OPTIONS}
          value={months.length ? months : [currentMonthValue()]}
          onChange={(v) => onChange({ mode: 'month', months: v.length ? v : [currentMonthValue()] })}
        />
      )}
      {mode === 'range' && (
        <>
          <Input type="date" aria-label={`${label} from`} value={from} max={to || undefined} onChange={(e) => onChange({ mode: 'range', from: e.target.value, to })} style={{ maxWidth: '10rem' }} />
          <span className="text-ink-3">to</span>
          <Input type="date" aria-label={`${label} to`} value={to} min={from || undefined} onChange={(e) => onChange({ mode: 'range', from, to: e.target.value })} style={{ maxWidth: '10rem' }} />
        </>
      )}
    </div>
  );
}

export function Pager({ page, totalPages, total, onPage }) {
  if (!totalPages || totalPages <= 1) return total ? <p className="text-ink-3">{Number(total).toLocaleString('en-IN')} rows</p> : null;
  return (
    <div className="flex items-center" style={{ gap: '8px' }}>
      <Button variant="quiet" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
      <span className="text-ink-3">Page {page} of {totalPages} · {Number(total || 0).toLocaleString('en-IN')} rows</span>
      <Button variant="quiet" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</Button>
    </div>
  );
}
