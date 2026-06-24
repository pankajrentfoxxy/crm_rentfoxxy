import React from 'react';
import { Loader2, Search, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

/**
 * Shared design-system primitives for a consistent, professional, mobile-first CRM.
 *
 * Goals (CRM is used by many non-technical / field staff on phones):
 *  - Big tap targets (>=44px), clear labels, obvious primary actions.
 *  - One consistent look for headers, cards, buttons, badges and tables.
 *  - Tables that gracefully become cards on small screens.
 *
 * These are additive — adopt per-page; they don't override anything globally.
 */

/* ── Button ──────────────────────────────────────────────────────────────── */
const BTN_VARIANTS = {
  primary: 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 shadow-sm',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 active:bg-slate-100',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 active:bg-slate-200',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800 shadow-sm',
  danger: 'bg-red-600 text-white hover:bg-red-700 active:bg-red-800 shadow-sm',
  subtle: 'bg-blue-50 text-blue-700 hover:bg-blue-100 active:bg-blue-200',
};
const BTN_SIZES = {
  sm: 'text-xs px-3 min-h-[36px] gap-1.5',
  md: 'text-sm px-4 min-h-[44px] gap-2',
  lg: 'text-base px-5 min-h-[52px] gap-2.5',
};

export function Button({
  variant = 'primary', size = 'md', icon: Icon, iconRight: IconRight,
  loading = false, disabled, className = '', children, ...props
}) {
  return (
    <button
      type={props.type || 'button'}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center font-semibold rounded-xl transition-colors
        disabled:opacity-50 disabled:cursor-not-allowed select-none
        ${BTN_VARIANTS[variant] || BTN_VARIANTS.primary} ${BTN_SIZES[size] || BTN_SIZES.md} ${className}`}
      {...props}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (Icon ? <Icon className="w-4 h-4 shrink-0" /> : null)}
      {children}
      {IconRight && !loading ? <IconRight className="w-4 h-4 shrink-0" /> : null}
    </button>
  );
}

/* ── Badge ───────────────────────────────────────────────────────────────── */
const BADGE_TONES = {
  gray: 'bg-slate-100 text-slate-700',
  blue: 'bg-blue-100 text-blue-700',
  green: 'bg-emerald-100 text-emerald-700',
  amber: 'bg-amber-100 text-amber-700',
  red: 'bg-red-100 text-red-700',
  purple: 'bg-violet-100 text-violet-700',
  orange: 'bg-orange-100 text-orange-700',
};
export function Badge({ tone = 'gray', className = '', children }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${BADGE_TONES[tone] || BADGE_TONES.gray} ${className}`}>
      {children}
    </span>
  );
}

/* ── PageHeader ──────────────────────────────────────────────────────────── */
export function PageHeader({ title, subtitle, icon: Icon, actions, children }) {
  return (
    <div className="mb-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          {Icon && (
            <span className="shrink-0 w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Icon className="w-5 h-5" />
            </span>
          )}
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 truncate">{title}</h1>
            {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

/* ── Card ────────────────────────────────────────────────────────────────── */
export function Card({ className = '', children, ...props }) {
  return (
    <div className={`bg-white border border-slate-200 rounded-2xl shadow-sm ${className}`} {...props}>
      {children}
    </div>
  );
}

export function StatCard({ label, value, icon: Icon, tone = 'blue', hint, onClick }) {
  const tones = {
    blue: 'text-blue-600 bg-blue-50',
    green: 'text-emerald-600 bg-emerald-50',
    amber: 'text-amber-600 bg-amber-50',
    red: 'text-red-600 bg-red-50',
    purple: 'text-violet-600 bg-violet-50',
    gray: 'text-slate-600 bg-slate-100',
  };
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`text-left w-full bg-white border border-slate-200 rounded-2xl p-4 shadow-sm
        ${onClick ? 'hover:border-blue-300 hover:shadow transition cursor-pointer' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
        {Icon && <span className={`w-8 h-8 rounded-lg flex items-center justify-center ${tones[tone] || tones.blue}`}><Icon className="w-4 h-4" /></span>}
      </div>
      <p className="text-2xl font-bold text-slate-900 mt-2">{value}</p>
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </Comp>
  );
}

/* ── EmptyState / Loader ─────────────────────────────────────────────────── */
export function EmptyState({ icon: Icon, title = 'Nothing here yet', hint, action }) {
  return (
    <div className="text-center py-12 px-4 bg-white rounded-2xl border border-slate-200">
      {Icon && <Icon className="w-10 h-10 text-slate-300 mx-auto mb-3" />}
      <p className="font-semibold text-slate-700">{title}</p>
      {hint && <p className="text-sm text-slate-400 mt-1 max-w-sm mx-auto">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function SectionLoader({ label = 'Loading…' }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-500">
      <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      <p className="text-sm mt-3">{label}</p>
    </div>
  );
}

/* ── ResponsiveTable ─────────────────────────────────────────────────────────
 * Desktop: a normal table. Mobile (< sm): a stacked card per row via `renderCard`.
 * columns: [{ key, header, render?(row), className?, align? }]
 * If renderCard is omitted, a sensible default key/value card is rendered.
 */
export function ResponsiveTable({
  columns = [], rows = [], keyField = 'id', renderCard, onRowClick,
  loading = false, empty, className = '',
  sortKey, sortDirection, onSort,
}) {
  if (loading) return <SectionLoader />;
  if (!rows.length) {
    return empty || <EmptyState title="No records found" />;
  }

  const align = (a) => (a === 'right' ? 'text-right' : a === 'center' ? 'text-center' : 'text-left');
  const keyOf = (row, i) => row[keyField] ?? i;

  const renderSortIcon = (col) => {
    const colKey = col.sortKey || col.key;
    if (sortKey !== colKey) return <ChevronsUpDown className="w-3.5 h-3.5 opacity-40" />;
    return sortDirection === 'asc'
      ? <ChevronUp className="w-3.5 h-3.5" />
      : <ChevronDown className="w-3.5 h-3.5" />;
  };

  const renderHeader = (c) => {
    if (c.sortable && onSort) {
      const colKey = c.sortKey || c.key;
      return (
        <button
          type="button"
          onClick={() => onSort(colKey)}
          className="inline-flex items-center gap-1 hover:text-slate-800 transition-colors uppercase tracking-wide"
        >
          {c.header}
          {renderSortIcon(c)}
        </button>
      );
    }
    return c.header;
  };

  const defaultCard = (row) => (
    <div className="space-y-1.5">
      {columns.map((c) => (
        <div key={c.key} className="flex justify-between gap-3 text-sm">
          <span className="text-slate-400">{c.header}</span>
          <span className="text-slate-800 text-right font-medium">{c.render ? c.render(row) : row[c.key]}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className={className}>
      {/* Mobile cards (div wrapper so cards can contain their own action buttons) */}
      <div className="grid gap-3 sm:hidden">
        {rows.map((row, i) => (
          <div
            key={keyOf(row, i)}
            role={onRowClick ? 'button' : undefined}
            tabIndex={onRowClick ? 0 : undefined}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter') onRowClick(row); } : undefined}
            className={`text-left bg-white border border-slate-200 rounded-2xl p-4 shadow-sm ${onRowClick ? 'active:bg-slate-50 cursor-pointer' : ''}`}
          >
            {(renderCard || defaultCard)(row)}
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden sm:block bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-slate-500 uppercase tracking-wide">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={`px-4 py-3 font-semibold ${align(c.align)}`}>{renderHeader(c)}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, i) => (
              <tr
                key={keyOf(row, i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={onRowClick ? 'hover:bg-slate-50 cursor-pointer' : ''}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`px-4 py-3 ${align(c.align)} ${c.className || ''}`}>
                    {c.render ? c.render(row) : row[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── SearchField ─────────────────────────────────────────────────────────── */
export function SearchField({ value, onChange, placeholder, className = '' }) {
  return (
    <div className={`relative flex-1 min-w-[220px] max-w-md ${className}`}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
      <input
        type="search"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm min-h-[44px]"
      />
    </div>
  );
}

/* ── ListPagination ──────────────────────────────────────────────────────── */
export function ListPagination({ page, totalPages, total, pageSize, onPageChange }) {
  if (!total && totalPages <= 1) return null;
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(page * pageSize, total || 0);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-4">
      <p className="text-sm text-slate-500">
        {total ? `Showing ${from}–${to} of ${total}` : 'No results'}
      </p>
      {totalPages > 1 ? (
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            Prev
          </Button>
          <span className="text-sm text-slate-600 py-2">Page {page} of {totalPages}</span>
          <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export default {
  Button, Badge, PageHeader, Card, StatCard, EmptyState, SectionLoader, ResponsiveTable,
  ListPagination, SearchField,
};
