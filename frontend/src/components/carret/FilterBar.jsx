import React from 'react';

/**
 * Filters COMBINE. Vendor + period returns the intersection, not whichever was
 * clicked last — the current screens replace one filter with the next, which is
 * why people export to a spreadsheet to answer two-dimensional questions.
 *
 * filters: [{ key, label, value, options:[{value,label}], type? }]
 */
export default function FilterBar({ filters = [], values = {}, onChange, onClear, right, className = '' }) {
  const active = filters.filter((f) => values[f.key] !== undefined && values[f.key] !== '' && values[f.key] !== null);

  return (
    <div
      className={`flex flex-wrap items-center bg-surface-2 border border-rule ${className}`}
      style={{ gap: 'var(--d-gap)', padding: 'var(--d-pad-y) var(--d-pad-x)', borderRadius: 'var(--d-radius)' }}
    >
      {filters.map((f) => (
        <label key={f.key} className="inline-flex items-center font-ui text-ink-2" style={{ gap: 'var(--d-gap)', fontSize: 'var(--d-sm)' }}>
          <span className="text-ink-3">{f.label}</span>
          {f.type === 'search' ? (
            <input
              type="search"
              value={values[f.key] ?? ''}
              placeholder={f.placeholder || ''}
              onChange={(e) => onChange?.(f.key, e.target.value)}
              className="bg-surface border border-rule text-ink font-ui"
              style={{ padding: 'var(--d-pad-y) var(--d-pad-x)', minHeight: 'var(--d-tap)', borderRadius: 'var(--d-radius)', fontSize: 'var(--d-base)' }}
            />
          ) : (
            <select
              value={values[f.key] ?? ''}
              onChange={(e) => onChange?.(f.key, e.target.value)}
              className="bg-surface border border-rule text-ink font-ui"
              style={{ padding: 'var(--d-pad-y) var(--d-pad-x)', minHeight: 'var(--d-tap)', borderRadius: 'var(--d-radius)', fontSize: 'var(--d-base)' }}
            >
              <option value="">All</option>
              {(f.options || []).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          )}
        </label>
      ))}

      {active.length > 0 && onClear && (
        <button
          type="button"
          onClick={onClear}
          className="font-ui text-accent bg-transparent border-0 cursor-pointer"
          style={{ fontSize: 'var(--d-sm)', minHeight: 'var(--d-tap)' }}
        >
          Clear {active.length}
        </button>
      )}
      {right && <div className="ml-auto">{right}</div>}
    </div>
  );
}
