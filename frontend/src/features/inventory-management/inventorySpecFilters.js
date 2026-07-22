export const SPEC_FILTER_KEYS = [
  'brand', 'model', 'processor', 'generation', 'ram', 'storage', 'screen_size', 'gpu',
];

export const EMPTY_SPEC_FILTERS = {
  brand: '',
  model: '',
  processor: '',
  generation: '',
  ram: '',
  storage: '',
  screen_size: '',
  gpu: '',
};

export function specFiltersToParams(filters = {}) {
  const params = {};
  for (const key of SPEC_FILTER_KEYS) {
    const v = (filters[key] || '').trim();
    if (v) params[key] = v;
  }
  return params;
}

export function hasActiveSpecFilters(filters = {}) {
  return SPEC_FILTER_KEYS.some((k) => String(filters[k] || '').trim());
}
