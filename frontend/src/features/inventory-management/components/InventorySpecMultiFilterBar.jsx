import React from 'react';
import MultiSelectFilter from '../../lead-crm/components/MultiSelectFilter';
import useInventorySpecFilterOptions from '../hooks/useInventorySpecFilterOptions';
import {
  EMPTY_SPEC_FILTERS,
  hasActiveSpecMultiFilters,
  parseSpecMultiUrl,
} from '../inventorySpecFilters';

const FILTER_FIELDS = [
  { key: 'brand', label: 'Brand', optionsKey: 'brands', allLabel: 'All brands', brandScoped: false },
  { key: 'model', label: 'Model', optionsKey: 'models', allLabel: 'All models', brandScoped: true },
  { key: 'processor', label: 'Processor', optionsKey: 'processors', allLabel: 'All processors', brandScoped: true },
  { key: 'generation', label: 'Gen', optionsKey: 'generations', allLabel: 'All gens', brandScoped: true },
  { key: 'ram', label: 'RAM', optionsKey: 'rams', allLabel: 'All RAM', brandScoped: false },
  { key: 'storage', label: 'SSD', optionsKey: 'storages', allLabel: 'All SSD', brandScoped: false },
  { key: 'screen_size', label: 'Screen', optionsKey: 'screen_sizes', allLabel: 'All screens', brandScoped: false },
  { key: 'gpu', label: 'GPU', optionsKey: 'gpus', allLabel: 'All GPU', brandScoped: false },
];

export default function InventorySpecMultiFilterBar({
  filters = EMPTY_SPEC_FILTERS,
  onChange,
  onClear,
  className = '',
}) {
  const brandSelections = parseSpecMultiUrl(filters.brand);
  const { options, loading } = useInventorySpecFilterOptions(brandSelections[0] || '', true);
  const active = hasActiveSpecMultiFilters(filters);
  const brandScopeKey = brandSelections[0] || 'all';
  const displayOptions = loading
    ? { brands: [], models: [], processors: [], generations: [], rams: [], storages: [], gpus: [], screen_sizes: [] }
    : options;

  const setField = (key, values) => {
    onChange({ [key]: values.length ? values.join(',') : '' });
  };

  const setBrand = (values) => {
    onChange({
      brand: values.length ? values.join(',') : '',
      model: '',
      processor: '',
      generation: '',
    });
  };

  return (
    <div className={`rounded-lg border border-slate-200 bg-slate-50/90 px-2 py-1.5 ${className}`}>
      <div className="flex flex-wrap items-end gap-x-1.5 gap-y-1.5">
        {FILTER_FIELDS.map(({ key, label, optionsKey, allLabel, brandScoped }) => (
          <div key={brandScoped ? `${brandScopeKey}-${key}` : key} className="min-w-[7.5rem] max-w-[10rem] flex-1">
            <p className="text-[10px] font-semibold text-slate-500 mb-0.5 px-0.5">{label}</p>
            <MultiSelectFilter
              options={displayOptions[optionsKey] || []}
              value={parseSpecMultiUrl(filters[key])}
              onChange={(vals) => (key === 'brand' ? setBrand(vals) : setField(key, vals))}
              allLabel={allLabel}
              className="w-full"
            />
          </div>
        ))}
        {active ? (
          <button
            type="button"
            onClick={() => (onClear ? onClear() : onChange(Object.fromEntries(FILTER_FIELDS.map((f) => [f.key, '']))))}
            className="text-[10px] font-semibold text-sky-700 hover:underline px-1 py-1 mb-0.5 whitespace-nowrap"
          >
            Clear specs
          </button>
        ) : null}
      </div>
    </div>
  );
}
