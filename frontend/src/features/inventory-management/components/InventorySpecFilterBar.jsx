import React from 'react';
import useInventorySpecFilterOptions from '../hooks/useInventorySpecFilterOptions';
import { EMPTY_SPEC_FILTERS, hasActiveSpecFilters, parseSpecMultiUrl } from '../inventorySpecFilters';
import SearchableSpecSelect from './SearchableSpecSelect';

const FILTER_FIELDS = [
  { key: 'brand', label: 'Brand', optionsKey: 'brands', brandScoped: false },
  { key: 'model', label: 'Model', optionsKey: 'models', brandScoped: true },
  { key: 'processor', label: 'Processor', optionsKey: 'processors', brandScoped: true },
  { key: 'generation', label: 'Gen', optionsKey: 'generations', brandScoped: true },
  { key: 'ram', label: 'RAM', optionsKey: 'rams', brandScoped: false },
  { key: 'storage', label: 'SSD', optionsKey: 'storages', brandScoped: false },
  { key: 'screen_size', label: 'Screen', optionsKey: 'screen_sizes', brandScoped: false },
  { key: 'gpu', label: 'GPU', optionsKey: 'gpus', brandScoped: false },
];

export default function InventorySpecFilterBar({
  filters = EMPTY_SPEC_FILTERS,
  onChange,
  onClear,
  className = '',
}) {
  const { options, loading } = useInventorySpecFilterOptions(filters.brand, true);
  const active = hasActiveSpecFilters(filters);
  const brandScopeKey = parseSpecMultiUrl(filters.brand).join('|') || 'all';
  const displayOptions = loading
    ? { brands: [], models: [], processors: [], generations: [], rams: [], storages: [], gpus: [], screen_sizes: [] }
    : options;

  const setField = (key, value) => {
    const nextValue = Array.isArray(value) ? value.filter(Boolean).join(',') : (value || '');
    if (key === 'brand') {
      onChange({ ...filters, brand: nextValue, model: '', processor: '', generation: '' });
      return;
    }
    onChange({ ...filters, [key]: nextValue });
  };

  return (
    <div className={`rounded-lg border border-slate-200 bg-slate-50/90 px-2 py-1.5 ${className}`}>
      <div className="flex flex-wrap items-end gap-x-1 gap-y-1">
        {FILTER_FIELDS.map(({ key, label, optionsKey, brandScoped }) => (
          <SearchableSpecSelect
            key={brandScoped ? `${brandScopeKey}-${key}` : key}
            label={label}
            multiple
            value={parseSpecMultiUrl(filters[key])}
            onChange={(v) => setField(key, v)}
            options={displayOptions[optionsKey] || []}
            disabled={loading}
            placeholder="All"
          />
        ))}
        {active ? (
          <button
            type="button"
            onClick={() => (onClear ? onClear() : onChange(EMPTY_SPEC_FILTERS))}
            className="text-[10px] font-semibold text-sky-700 hover:underline px-1 py-1 mb-0.5 whitespace-nowrap"
          >
            Clear specs
          </button>
        ) : null}
      </div>
    </div>
  );
}
