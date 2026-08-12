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

/** Parse comma-separated spec values from URL filter strings. */
export function parseSpecMultiUrl(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v || '').trim()).filter(Boolean);
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

export function specMultiFiltersToParams(filters = {}) {
  const params = {};
  for (const key of SPEC_FILTER_KEYS) {
    const vals = parseSpecMultiUrl(filters[key]);
    if (vals.length) params[key] = vals.join(',');
  }
  return params;
}

export function hasActiveSpecMultiFilters(filters = {}) {
  return SPEC_FILTER_KEYS.some((k) => parseSpecMultiUrl(filters[k]).length > 0);
}

export function hasActiveSpecFilters(filters = {}) {
  return SPEC_FILTER_KEYS.some((k) => String(filters[k] || '').trim());
}
