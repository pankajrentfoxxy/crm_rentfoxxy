/** URL param helpers for Return DC list column filters (cf_*). */

export const RDC_COLUMN_KEYS = [
  'return_dc_number',
  'created_at',
  'pickup_date',
  'customer_name',
  'city',
  'unit_count',
  'original_dc_number',
  'sales_order_number',
  'reason',
  'status',
  'warehouse',
];

export const RDC_COLUMN_TYPES = {
  return_dc_number: 'text',
  created_at: 'date',
  pickup_date: 'date',
  customer_name: 'text',
  city: 'text',
  unit_count: 'number',
  original_dc_number: 'text',
  sales_order_number: 'text',
  reason: 'text',
  status: 'text',
  warehouse: 'text',
};

export const RDC_TABLE_COLUMNS = [
  { key: 'return_dc_number', label: 'RDC #' },
  { key: 'created_at', label: 'Created' },
  { key: 'pickup_date', label: 'Pickup Date' },
  { key: 'customer_name', label: 'Customer' },
  { key: 'city', label: 'City' },
  { key: 'unit_count', label: 'Units', align: 'right' },
  { key: 'original_dc_number', label: 'Original DC' },
  { key: 'sales_order_number', label: 'SO #' },
  { key: 'reason', label: 'Reason' },
  { key: 'status', label: 'Status' },
  { key: 'warehouse', label: 'Warehouse' },
];

function splitCsv(val) {
  return String(val || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function readColumnFiltersFromParams(searchParams) {
  const state = {};
  RDC_COLUMN_KEYS.forEach((key) => {
    const type = RDC_COLUMN_TYPES[key];
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
  RDC_COLUMN_KEYS.forEach((key) => {
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
