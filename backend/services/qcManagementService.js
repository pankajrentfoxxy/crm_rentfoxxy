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

function parseFilePaths(ex) {
  const raw = ex.file_path ?? ex.file_paths;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p.map(String) : [raw];
    } catch {
      return [raw];
    }
  }
  return [];
}

function parseRequireParts(ex) {
  const raw = ex.require_parts ?? ex.serial_require_parts;
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : raw ? [raw] : [];
    } catch {
      return raw.trim() ? [raw] : [];
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

function computeLockingPeriod(line, poType) {
  const months = Number(line?.vendor_locking_period ?? line?.locking_period ?? 0);
  const type = String(poType || '').toLowerCase();
  if (!Number.isFinite(months) || months <= 0) {
    if (type === 'direct_purchase') return { daysLeft: null, label: 'N/A' };
    return { daysLeft: null, label: '—' };
  }
  const start = line?.created_at ? new Date(line.created_at) : new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + months * 30);
  const daysLeft = daysBetween(new Date(), end);
  if (daysLeft == null) return { daysLeft: null, label: '—' };
  if (daysLeft > 0) return { daysLeft, label: `${daysLeft} Days Left` };
  if (type === 'direct_purchase') return { daysLeft, label: 'N/A' };
  return { daysLeft, label: 'Expired' };
}

function computeAddedDate(updatedAt) {
  if (!updatedAt) return { label: 'Today', daysAgo: 0 };
  const daysAgo = Math.abs(daysBetween(new Date(updatedAt), new Date()));
  if (!daysAgo) return { label: 'Today', daysAgo: 0 };
  return { label: `${daysAgo} Days Ago`, daysAgo };
}

function computePoTypePeriod(row, line, poType) {
  const today = new Date();
  const type = String(poType || '').toLowerCase();

  if (type === 'direct_purchase') {
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

  const rentalEnd = row.rental_start_date || line?.rental_period || line?.rental_end_date;
  if (!rentalEnd) return { daysLeft: null, label: '—' };
  const daysLeft = daysBetween(today, rentalEnd);
  if (daysLeft == null) return { daysLeft: null, label: '—' };
  if (daysLeft > 0) return { daysLeft, label: `Rent Starts in ${daysLeft} Days` };
  if (daysLeft === 0) return { daysLeft, label: 'Rent Starts Today' };
  const ago = Math.abs(daysLeft);
  return { daysLeft, label: `Rent Started ${ago} Days Ago` };
}

function enrichSerialRow(row) {
  const line = resolveLineItem(row.line_items, row.extra);
  const ex = parseExtra(row.extra);
  const brand = line?.brand_name ?? line?.brand ?? '';
  const model = line?.product_name ?? line?.model ?? '';
  const poType = row.purchase_order_type;
  const actionStatus = ex.action_status ?? null;
  const cameFrom = ex.came_from ?? null;

  let receivedFrom = { type: 'vendor', label: 'Vendor' };
  if (actionStatus) {
    if (ex.customer_name) {
      receivedFrom = { type: 'customer', label: ex.customer_name, customer_id: ex.customer_id ?? null };
    } else if (cameFrom) {
      receivedFrom = { type: 'other', label: String(cameFrom) };
    } else {
      receivedFrom = { type: 'na', label: 'N/A' };
    }
  }

  const remark =
    row.remark ||
    ex.remark ||
    (actionStatus ? ex.action_remark : ex.status2 === 'qc_reject' ? ex.remark : '') ||
    '';

  return {
    serial_id: row.serial_id,
    serial_number: row.serial_number,
    unique_product_serial: uniqueDisplay(row),
    qc_status: effectiveQcStatus(row),
    remark,
    action_status: actionStatus,
    action_remark: ex.action_remark ?? null,
    status2: ex.status2 ?? row.inventory_status ?? null,
    serial_created_at: row.serial_created_at,
    serial_updated_at: row.serial_updated_at,
    added_date: computeAddedDate(row.serial_updated_at),
    po_id: row.po_id,
    grn_id: row.grn_id,
    grn_number:
      ex.grn_number ||
      (row.grn_id != null ? `GRN-${String(row.grn_id).padStart(4, '0')}` : ''),
    purchase_order_number: row.purchase_order_number,
    purchase_order_type: poType,
    purchase_order_type_label: formatPoType(poType),
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
    locking_period: computeLockingPeriod(line, poType),
    po_type_period: computePoTypePeriod(row, line, poType),
    received_from: receivedFrom,
    file_paths: parseFilePaths(ex),
    hardware_action: ex.hardware_action ?? 'pending',
    hardware_remark: ex.hardware_remark ?? '',
    require_parts: parseRequireParts(ex),
    rental_period: row.rental_start_date || line?.rental_period || null,
    product_warranty: line?.warranty_months ?? line?.product_warranty ?? null
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
