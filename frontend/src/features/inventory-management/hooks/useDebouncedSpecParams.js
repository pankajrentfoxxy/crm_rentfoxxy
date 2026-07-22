import { useMemo } from 'react';
import useDebouncedValue from '../../../hooks/useDebouncedValue';
import { specFiltersToParams } from '../inventorySpecFilters';
/** Debounced API params for spec filters — stable object reference via useMemo. */
export default function useDebouncedSpecParams(specFilters, delay = 320) {
  const brand = useDebouncedValue(specFilters.brand, delay);
  const model = useDebouncedValue(specFilters.model, delay);
  const processor = useDebouncedValue(specFilters.processor, delay);
  const generation = useDebouncedValue(specFilters.generation, delay);
  const ram = useDebouncedValue(specFilters.ram, delay);
  const storage = useDebouncedValue(specFilters.storage, delay);
  const screen_size = useDebouncedValue(specFilters.screen_size, delay);
  const gpu = useDebouncedValue(specFilters.gpu, delay);

  return useMemo(
    () => specFiltersToParams({
      brand, model, processor, generation, ram, storage, screen_size, gpu,
    }),
    [brand, model, processor, generation, ram, storage, screen_size, gpu],
  );
}
