import React from 'react';
import InventorySpecFilterBar from '../../inventory-management/components/InventorySpecFilterBar';
import { EMPTY_SPEC_FILTERS } from '../../inventory-management/inventorySpecFilters';

/** Shared compact control height for floor pipeline list filters. */
export const FILTER_CTL =
  'h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-800 shrink-0 ' +
  'focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 hover:border-slate-300';

export default function FloorPipelineFilterPanel({
  children,
  specFilters = EMPTY_SPEC_FILTERS,
  onSpecFiltersChange,
  onSpecFiltersClear,
  className = '',
}) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white px-2 py-2 space-y-2 ${className}`}>
      <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
        {children}
      </div>
      <InventorySpecFilterBar
        filters={specFilters}
        onChange={onSpecFiltersChange}
        onClear={onSpecFiltersClear}
        className="border-0 bg-transparent px-0 py-0 rounded-none"
      />
    </div>
  );
}
