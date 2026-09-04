/** URL helpers for Gate Report laptop column filters (cf_*). */

export const GATE_COLUMN_KEYS = [
  'scan_time',
  'direction',
  'ttspl',
  'serial_number',
  'brand',
  'model',
  'source_type',
  'reference_number',
  'awb_number',
  'guard_name',
  'validation_result',
];

export const GATE_COLUMN_TYPES = {
  scan_time: 'date',
  direction: 'text',
  ttspl: 'text',
  serial_number: 'text',
  brand: 'text',
  model: 'text',
  source_type: 'text',
  reference_number: 'text',
  awb_number: 'text',
  guard_name: 'text',
  validation_result: 'text',
};

export const GATE_TABLE_COLUMNS = [
  { key: 'scan_time', label: 'Scan time' },
  { key: 'direction', label: 'Direction' },
  { key: 'ttspl', label: 'TTSPL' },
  { key: 'serial_number', label: 'Serial' },
  { key: 'brand', label: 'Brand' },
  { key: 'model', label: 'Model' },
  { key: 'source_type', label: 'Source' },
  { key: 'reference_number', label: 'DC / RDC' },
  { key: 'awb_number', label: 'AWB' },
  { key: 'guard_name', label: 'Guard' },
  { key: 'validation_result', label: 'Result' },
];

function splitCsv(val) {
  return String(val || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function readColumnFiltersFromParams(searchParams) {
  const state = {};
  GATE_COLUMN_KEYS.forEach((key) => {
    const type = GATE_COLUMN_TYPES[key];
    if (type === 'text') {
      const vals = splitCsv(searchParams.get(`cf_${key}`));
      if (vals.length) state[key] = { type: 'text', values: vals };
    } else if (type === 'date') {
      const from = searchParams.get(`cf_${key}_from`) || '';
      const to = searchParams.get(`cf_${key}_to`) || '';
      if (from || to) state[key] = { type: 'date', from: from || null, to: to || null };
    }
  });
  return state;
}

export function columnFiltersToParams(state = {}) {
  const params = {};
  Object.entries(state).forEach(([key, filter]) => {
    if (!filter) return;
    if (filter.type === 'text' && filter.values?.length) {
      params[`cf_${key}`] = filter.values.join(',');
    } else if (filter.type === 'date') {
      if (filter.from) params[`cf_${key}_from`] = filter.from;
      if (filter.to) params[`cf_${key}_to`] = filter.to;
    }
  });
  return params;
}

export function clearColumnFilterParams(searchParams) {
  const next = new URLSearchParams(searchParams);
  GATE_COLUMN_KEYS.forEach((key) => {
    next.delete(`cf_${key}`);
    next.delete(`cf_${key}_from`);
    next.delete(`cf_${key}_to`);
  });
  return next;
}
