/**
 * QC Management helpers — Laravel serial_numbers.status parity on vendor_serial_numbers.
 */

const VALID_STATUSES = new Set([
  'pending',
  'passed',
  'failed',
  'dead',
  'require_for_parts'
]);

/** CRM route segment → Laravel serial_numbers.status */
const ROUTE_STATUS_MAP = {
  processing: 'pending',
  passed: 'passed',
  failed: 'failed',
  'dead-assets': 'dead',
  'require-for-parts': 'require_for_parts'
};

function parseExtra(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return typeof p === 'object' && p !== null && !Array.isArray(p) ? p : {};
    } catch {
      return {};
    }
  }
  return {};
}

function parseLineItems(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

function effectiveQcStatus(row) {
  const col = row.qc_status != null ? String(row.qc_status).trim() : '';
  if (col) return col;
  const ex = parseExtra(row.extra);
  const fromExtra = ex.status != null ? String(ex.status).trim() : '';
  if (fromExtra) return fromExtra;
  return 'pending';
}

function resolveLineItem(lineItems, extraRaw) {
  const lines = parseLineItems(lineItems);
  const ex = parseExtra(extraRaw);
  const idx =
    ex.line_index !== undefined && ex.line_index !== null ? Number(ex.line_index) : NaN;
  if (Number.isFinite(idx) && idx >= 0 && lines[idx]) return lines[idx];
  const pd = ex.product_detail_id ?? ex.pro_id ?? ex.product_id;
  if (pd !== undefined && pd !== null && String(pd).trim() !== '') {
    const k = String(pd);
    const found = lines.find(
      (l) =>
        String(l.product_detail_id ?? l.product_id ?? l.pro_id ?? l.id ?? '') === k
    );
    if (found) return found;
  }
  if (lines.length === 1) return lines[0];
  return null;
}

function uniqueDisplay(row) {
  if (row.inventory_asset_code) return String(row.inventory_asset_code);
  const ex = parseExtra(row.extra);
  return ex.unique_product_serial || ex.unique_number || '';
}

function formatPoType(t) {
  if (!t) return '';
  return String(t)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function daysBetween(fromDate, toDate) {
  const a = new Date(fromDate);
  const b = new Date(toDate);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const ms = b.setHours(0, 0, 0, 0) - a.setHours(0, 0, 0, 0);
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

function computeLockingPeriod(line) {
  const months = Number(line?.vendor_locking_period ?? line?.locking_period ?? 0);
  if (!Number.isFinite(months) || months <= 0) return { daysLeft: null, label: '—' };
  const start = line?.created_at ? new Date(line.created_at) : new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + months * 30);
  const daysLeft = daysBetween(new Date(), end);
  if (daysLeft == null) return { daysLeft: null, label: '—' };
  if (daysLeft > 0) return { daysLeft, label: `${daysLeft} Days Left` };
  return { daysLeft, label: 'Expired' };
}

function computePoTypePeriod(row, line, poType) {
  const today = new Date();
  const type = String(poType || '').toLowerCase();
  if (type === 'rental_purchase' || type === 'rent_to_own') {
    const rentalEnd = row.rental_start_date || line?.rental_period || line?.rental_end_date;
    if (!rentalEnd) return { daysLeft: null, label: '—' };
    const daysLeft = daysBetween(today, rentalEnd);
    if (daysLeft == null) return { daysLeft: null, label: '—' };
    if (daysLeft > 0) return { daysLeft, label: `Rent Start in ${daysLeft} Days` };
    return { daysLeft, label: 'Expired' };
  }
  const warrantyMonths = Number(line?.warranty_months ?? line?.product_warranty ?? 0);
  const start = row.serial_created_at || row.created_at;
  if (!start || !warrantyMonths) return { daysLeft: null, label: '—' };
  const startD = new Date(start);
  const endD = new Date(startD);
  endD.setDate(endD.getDate() + warrantyMonths * 30);
  const daysLeft = daysBetween(today, endD);
  if (daysLeft == null) return { daysLeft: null, label: '—' };
  if (daysLeft > 0) return { daysLeft, label: `Warranty Left in ${daysLeft} Days` };
  return { daysLeft, label: 'Expired' };
}

function enrichSerialRow(row) {
  const line = resolveLineItem(row.line_items, row.extra);
  const ex = parseExtra(row.extra);
  const brand = line?.brand_name ?? line?.brand ?? '';
  const model = line?.product_name ?? line?.model ?? '';
  const locking = computeLockingPeriod(line);
  const poPeriod = computePoTypePeriod(row, line, row.purchase_order_type);

  return {
    serial_id: row.serial_id,
    serial_number: row.serial_number,
    unique_product_serial: uniqueDisplay(row),
    qc_status: effectiveQcStatus(row),
    remark: row.remark || ex.remark || '',
    serial_created_at: row.serial_created_at,
    serial_updated_at: row.serial_updated_at,
    po_id: row.po_id,
    grn_id: row.grn_id,
    grn_number: row.grn_id != null ? `GRN-${String(row.grn_id).padStart(4, '0')}` : '',
    purchase_order_number: row.purchase_order_number,
    purchase_order_type: row.purchase_order_type,
    purchase_order_type_label: formatPoType(row.purchase_order_type),
    vendor_id: row.vendor_id,
    vendor_name: row.vendor_name || row.business_name || '',
    product_id: line?.product_detail_id ?? line?.product_id ?? ex.product_detail_id ?? null,
    item_description: {
      brand,
      model,
      screen_size: line?.screen_size ?? '',
      processor: line?.processor ?? '',
      generation: line?.generation ?? '',
      ram: line?.ram ?? '',
      storage: line?.storage ?? '',
      gpu: line?.gpu ?? ''
    },
    locking_period: locking,
    po_type_period: poPeriod,
    hardware_action: ex.hardware_action ?? null,
    status2: ex.status2 ?? row.inventory_status ?? null,
    require_parts: ex.require_parts ?? null
  };
}

function normalizeRouteStatus(input) {
  const raw = String(input || '').trim();
  if (ROUTE_STATUS_MAP[raw]) return ROUTE_STATUS_MAP[raw];
  if (VALID_STATUSES.has(raw)) return raw;
  return null;
}

const EFFECTIVE_STATUS_SQL = `COALESCE(
  NULLIF(TRIM(s.qc_status), ''),
  NULLIF(TRIM(s.extra->>'status'), ''),
  'pending'
)`;

module.exports = {
  VALID_STATUSES,
  ROUTE_STATUS_MAP,
  EFFECTIVE_STATUS_SQL,
  parseExtra,
  parseLineItems,
  effectiveQcStatus,
  resolveLineItem,
  enrichSerialRow,
  normalizeRouteStatus,
  formatPoType
};
