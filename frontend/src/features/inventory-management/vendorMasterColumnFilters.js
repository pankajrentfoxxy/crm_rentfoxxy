/** URL param helpers for Vendor Master laptop column filters (cf_*). */

export const VMD_COLUMN_KEYS = [
  'ttspl_id',
  'serial_number',
  'vendor_name',
  'purchase_date',
  'purchase_order_number',
  'purchase_rate',
  'brand',
  'model',
  'specs',
  'current_status',
  'location_label',
  'current_stage',
  'customer_name',
  'so_dc',
  'sale_rent',
  'last_movement_date',
];

export const VMD_COLUMN_TYPES = {
  ttspl_id: 'text',
  serial_number: 'text',
  vendor_name: 'text',
  purchase_date: 'date',
  purchase_order_number: 'text',
  purchase_rate: 'number',
  brand: 'text',
  model: 'text',
  specs: 'text',
  current_status: 'text',
  location_label: 'text',
  current_stage: 'text',
  customer_name: 'text',
  so_dc: 'text',
  sale_rent: 'text',
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
  VMD_COLUMN_KEYS.forEach((key) => {
    const type = VMD_COLUMN_TYPES[key];
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

export function isColumnFilterActive(filter) {
  if (!filter) return false;
  if (filter.type === 'text') return filter.values?.length > 0;
  if (filter.type === 'date') return Boolean(filter.from || filter.to);
  if (filter.type === 'number') {
    if (filter.op === 'eq') return filter.eq != null && !Number.isNaN(filter.eq);
    return filter.min != null || filter.max != null;
  }
  return false;
}

export function clearColumnFilterParams(searchParams) {
  const next = new URLSearchParams(searchParams);
  VMD_COLUMN_KEYS.forEach((key) => {
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
