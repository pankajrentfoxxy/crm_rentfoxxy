import React from 'react';
import { defaultRange } from '../reportingUtils';

const MONTHS = [
  { v: 1, l: 'Jan' }, { v: 2, l: 'Feb' }, { v: 3, l: 'Mar' }, { v: 4, l: 'Apr' },
  { v: 5, l: 'May' }, { v: 6, l: 'Jun' }, { v: 7, l: 'Jul' }, { v: 8, l: 'Aug' },
  { v: 9, l: 'Sep' }, { v: 10, l: 'Oct' }, { v: 11, l: 'Nov' }, { v: 12, l: 'Dec' },
];

const YEARS = [2024, 2025, 2026, 2027];

export default function ReportFilters({
  filters,
  onChange,
  onApply,
  fields = ['dateRange'],
}) {
  const set = (key, value) => onChange({ ...filters, [key]: value });

  const reset = () => {
    const dr = defaultRange();
    const next = { ...filters, from: dr.from, to: dr.to };
    onChange(next);
    if (onApply) onApply(next);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-wrap gap-3 items-end">
      {fields.includes('dateRange') && (
        <>
          <label className="text-sm">
            <span className="block text-gray-500 text-xs mb-1">From</span>
            <input
              type="date"
              value={filters.from || ''}
              onChange={(e) => set('from', e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="block text-gray-500 text-xs mb-1">To</span>
            <input
              type="date"
              value={filters.to || ''}
              onChange={(e) => set('to', e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
          </label>
        </>
      )}
      {fields.includes('month') && (
        <label className="text-sm">
          <span className="block text-gray-500 text-xs mb-1">Month</span>
          <select
            value={filters.month || ''}
            onChange={(e) => set('month', e.target.value ? Number(e.target.value) : '')}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm min-w-[120px]"
          >
            <option value="">All months</option>
            {MONTHS.map((m) => (
              <option key={m.v} value={m.v}>{m.l}</option>
            ))}
          </select>
        </label>
      )}
      {fields.includes('year') && (
        <label className="text-sm">
          <span className="block text-gray-500 text-xs mb-1">Year</span>
          <select
            value={filters.year || new Date().getFullYear()}
            onChange={(e) => set('year', Number(e.target.value))}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm min-w-[100px]"
          >
            {YEARS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
      )}
      {fields.includes('type') && (
        <label className="text-sm">
          <span className="block text-gray-500 text-xs mb-1">Type</span>
          <select
            value={filters.type || ''}
            onChange={(e) => set('type', e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm min-w-[120px]"
          >
            <option value="">All</option>
            <option value="rental">Rental</option>
            <option value="sale">Sale</option>
          </select>
        </label>
      )}
      {onApply ? (
        <button
          type="button"
          onClick={() => onApply(filters)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700"
        >
          Apply
        </button>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="border border-gray-200 text-gray-600 px-4 py-2 rounded-lg text-sm hover:bg-gray-50"
      >
        Reset
      </button>
    </div>
  );
}
