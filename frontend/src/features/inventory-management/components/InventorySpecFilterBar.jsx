import React from 'react';
import useInventorySpecFilterOptions from '../hooks/useInventorySpecFilterOptions';
import { EMPTY_SPEC_FILTERS, hasActiveSpecFilters } from '../inventorySpecFilters';
import SearchableSpecSelect from './SearchableSpecSelect';

const FILTER_FIELDS = [
  { key: 'brand', label: 'Brand', optionsKey: 'brands' },
  { key: 'model', label: 'Model', optionsKey: 'models' },
  { key: 'processor', label: 'Processor', optionsKey: 'processors' },
  { key: 'generation', label: 'Gen', optionsKey: 'generations' },
  { key: 'ram', label: 'RAM', optionsKey: 'rams' },
  { key: 'storage', label: 'SSD', optionsKey: 'storages' },
  { key: 'screen_size', label: 'Screen', optionsKey: 'screen_sizes' },
  { key: 'gpu', label: 'GPU', optionsKey: 'gpus' },
];

export default function InventorySpecFilterBar({
  filters = EMPTY_SPEC_FILTERS,
  onChange,
  onClear,
  className = '',
}) {
  const { options, loading } = useInventorySpecFilterOptions(true);
  const active = hasActiveSpecFilters(filters);

  const setField = (key, value) => {
    onChange({ ...filters, [key]: value });
  };

  return (
    <div className={`rounded-lg border border-slate-200 bg-slate-50/90 px-2 py-1.5 ${className}`}>
      <div className="flex flex-wrap items-end gap-x-1 gap-y-1">
        {FILTER_FIELDS.map(({ key, label, optionsKey }) => (
          <SearchableSpecSelect
            key={key}
            label={label}
            value={filters[key] || ''}
            onChange={(v) => setField(key, v)}
            options={options[optionsKey] || []}
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
