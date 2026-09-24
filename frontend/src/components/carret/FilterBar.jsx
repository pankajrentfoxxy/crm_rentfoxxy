import React from 'react';
import { Search } from 'lucide-react';

/**
 * Filters COMBINE. Vendor + period returns the intersection, not whichever was
 * clicked last — the current screens replace one filter with the next, which is
 * why people export to a spreadsheet to answer two-dimensional questions.
 *
 * A select names itself inside its own value ("Status: All"), so the bar needs
 * no separate labels and stays one clean row. A select that is set is tinted,
 * so a filtered list never looks like the whole list.
 *
 * filters: [{ key, label, options:[{value,label}], type?, placeholder? }]
 * count:   the "12 customers" text at the right-hand end
 */
export default function FilterBar({ filters = [], values = {}, onChange, onClear, right, count, className = '' }) {
  const active = filters.filter((f) => values[f.key] !== undefined && values[f.key] !== '' && values[f.key] !== null);

  return (
    <div className={`c-toolbar font-ui ${className}`}>
      {filters.map((f) => (f.type === 'search' ? (
        <label key={f.key} className="c-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">{f.label}</span>
          <input
            type="search"
            className="c-input"
            value={values[f.key] ?? ''}
            placeholder={f.placeholder || f.label || 'Search'}
            onChange={(e) => onChange?.(f.key, e.target.value)}
          />
        </label>
      ) : (
        <label key={f.key}>
          <span className="sr-only">{f.label}</span>
          <select
            className={`c-select ${values[f.key] ? 'is-set' : ''}`}
            value={values[f.key] ?? ''}
            onChange={(e) => onChange?.(f.key, e.target.value)}
          >
            <option value="">{f.label}: All</option>
            {(f.options || []).map((o) => (
              <option key={o.value} value={o.value}>{f.label}: {o.label}</option>
            ))}
          </select>
        </label>
      )))}

      {active.length > 0 && onClear && (
        <button type="button" onClick={onClear} className="c-btn c-btn--quiet">
          Clear {active.length === 1 ? 'filter' : `${active.length} filters`}
        </button>
      )}

      {(count != null || right) && (
        <div className="c-toolbar-end">
          {count != null && <span>{count}</span>}
          {right}
        </div>
      )}
    </div>
  );
}
