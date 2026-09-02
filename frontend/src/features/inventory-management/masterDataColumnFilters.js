/** URL param helpers for Master Data laptop column filters (cf_*). */

export const MD_COLUMN_KEYS = [
  'ttspl_id',
  'serial_number',
  'specs',
  'current_status',
  'current_location',
  'customer_name',
  'vendor_name',
  'vendor_type',
  'vendor_price',
  'customer_price',
  'current_stage',
  'sales_order_number',
  'delivery_challan_number',
  'purchase_order_number',
  'grn_number',
];

export const MD_COLUMN_TYPES = {
  ttspl_id: 'text',
  serial_number: 'text',
  specs: 'text',
  current_status: 'text',
  current_location: 'text',
  customer_name: 'text',
  vendor_name: 'text',
  vendor_type: 'text',
  vendor_price: 'text',
  customer_price: 'text',
  current_stage: 'text',
  sales_order_number: 'text',
  delivery_challan_number: 'text',
  purchase_order_number: 'text',
  grn_number: 'text',
};

function splitCsv(val) {
  return String(val || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function readColumnFiltersFromParams(searchParams) {
  const state = {};
  MD_COLUMN_KEYS.forEach((key) => {
    const type = MD_COLUMN_TYPES[key];
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
  MD_COLUMN_KEYS.forEach((key) => {
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
  { key: 'specs', label: 'Specs', align: 'left' },
  { key: 'current_status', label: 'Status', align: 'left' },
  { key: 'current_location', label: 'Location', align: 'left' },
  { key: 'customer_name', label: 'Current Customer', align: 'left', highlight: true },
  { key: 'vendor_name', label: 'Vendor', align: 'left', highlight: true },
  { key: 'vendor_type', label: 'Vendor Type', align: 'left', highlight: true },
  { key: 'vendor_price', label: 'Vendor Price', align: 'left', highlight: true },
  { key: 'customer_price', label: 'Customer Price', align: 'left', highlight: true },
  { key: 'current_stage', label: 'Stage', align: 'left' },
  { key: 'sales_order_number', label: 'SO', align: 'left' },
  { key: 'delivery_challan_number', label: 'DC', align: 'left' },
  { key: 'purchase_order_number', label: 'PO', align: 'left' },
  { key: 'grn_number', label: 'GRN', align: 'left' },
];
