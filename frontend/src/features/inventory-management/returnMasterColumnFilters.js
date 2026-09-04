/** URL param helpers for Return Master Data laptop column filters (cf_*). */

export const RMD_COLUMN_KEYS = [
  'ttspl_id',
  'serial_number',
  'previous_customer_name',
  'return_date',
  'return_dc_number',
  'return_type',
  'brand_model',
  'specs',
  'current_status',
  'current_location',
  'customer_name',
  'current_stage',
  'last_movement_date',
];

export const RMD_COLUMN_TYPES = {
  ttspl_id: 'text',
  serial_number: 'text',
  previous_customer_name: 'text',
  return_date: 'date',
  return_dc_number: 'text',
  return_type: 'text',
  brand_model: 'text',
  specs: 'text',
  current_status: 'text',
  current_location: 'text',
  customer_name: 'text',
  current_stage: 'text',
  last_movement_date: 'date',
};

function splitCsv(val) {
  return String(val || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function readColumnFiltersFromParams(searchParams) {
  const state = {};
  RMD_COLUMN_KEYS.forEach((key) => {
    const type = RMD_COLUMN_TYPES[key];
    if (type === 'text') {
      const vals = splitCsv(searchParams.get(`cf_${key}`));
      if (vals.length) state[key] = { type: 'text', values: vals };
    } else if (type === 'date') {
      const from = searchParams.get(`cf_${key}_from`) || '';
      const to = searchParams.get(`cf_${key}_to`) || '';
      if (from || to) state[key] = { type: 'date', from: from || null, to: to || null };
    } else if (type === 'number') {
      const eq = searchParams.get(`cf_${key}_eq`);
      if (eq !== null && eq !== '') {
        state[key] = { type: 'number', op: 'eq', eq: Number(eq) };
      } else {
        const op = searchParams.get(`cf_${key}_op`) || 'between';
        const min = searchParams.get(`cf_${key}_min`);
        const max = searchParams.get(`cf_${key}_max`);
        if ((min !== null && min !== '') || (max !== null && max !== '')) {
          state[key] = {
            type: 'number',
            op,
            min: min !== null && min !== '' ? Number(min) : null,
            max: max !== null && max !== '' ? Number(max) : null,
          };
        }
      }
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
    } else if (filter.type === 'number') {
      if (filter.op === 'eq' && filter.eq != null && !Number.isNaN(filter.eq)) {
        params[`cf_${key}_eq`] = String(filter.eq);
      } else {
        if (filter.op) params[`cf_${key}_op`] = filter.op;
        if (filter.min != null && !Number.isNaN(filter.min)) params[`cf_${key}_min`] = String(filter.min);
        if (filter.max != null && !Number.isNaN(filter.max)) params[`cf_${key}_max`] = String(filter.max);
      }
    }
  });
  return params;
}

export function clearColumnFilterParams(searchParams) {
  const next = new URLSearchParams(searchParams);
  RMD_COLUMN_KEYS.forEach((key) => {
    next.delete(`cf_${key}`);
    next.delete(`cf_${key}_from`);
    next.delete(`cf_${key}_to`);
    next.delete(`cf_${key}_min`);
    next.delete(`cf_${key}_max`);
    next.delete(`cf_${key}_eq`);
    next.delete(`cf_${key}_op`);
  });
  return next;
}

export const LAPTOP_TABLE_COLUMNS = [
  { key: 'ttspl_id', label: 'TTSPL', align: 'left' },
  { key: 'serial_number', label: 'Serial', align: 'left' },
  { key: 'previous_customer_name', label: 'Previous Customer', align: 'left' },
  { key: 'return_date', label: 'Return Date', align: 'left' },
  { key: 'return_dc_number', label: 'Return DC', align: 'left' },
  { key: 'return_type', label: 'Return Type', align: 'left' },
  { key: 'brand_model', label: 'Brand / Model', align: 'left' },
  { key: 'specs', label: 'Specs', align: 'left' },
  { key: 'current_status', label: 'Current Status', align: 'left' },
  { key: 'current_location', label: 'Current Location', align: 'left' },
  { key: 'customer_name', label: 'Current Customer', align: 'left' },
  { key: 'current_stage', label: 'Production Stage', align: 'left' },
  { key: 'last_movement_date', label: 'Last Movement', align: 'left' },
];
