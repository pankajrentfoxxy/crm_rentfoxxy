export const PRIMARY = '#2563EB';

export {
  modelsForBrand,
  generationsForProcessor,
  mergeAssetCatalog,
  EMPTY_ASSET_CATALOG,
} from '../../utils/assetCatalogUtils';

export const QUOTE_STATUS_STYLES = {
  draft: 'bg-gray-100 text-gray-700',
  pending: 'bg-gray-100 text-gray-700',
  sent: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
};

export const TYPE_STYLES = {
  rental: 'bg-blue-100 text-blue-800',
  demo: 'bg-violet-100 text-violet-800',
  sale: 'bg-emerald-100 text-emerald-800',
  sales: 'bg-emerald-100 text-emerald-800',
};

export const DC_STATUS_STYLES = {
  pending: 'bg-gray-100 text-gray-700',
  in_transit: 'bg-amber-100 text-amber-800',
  delivered: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-800',
};

export const DISPATCH_MODE_STYLES = {
  courier: 'bg-blue-100 text-blue-800',
  porter: 'bg-purple-100 text-purple-800',
  inhouse: 'bg-teal-100 text-teal-800',
};

export function formatCurrency(n) {
  const v = Number(n) || 0;
  return `₹ ${v.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** CRM route — SO numbers may contain slashes (e.g. SO/26-27/0590). */
export { salesOrderDetailPath, salesOrderListPath } from './salesOrderScope';

/** CRM route — DC numbers may contain slashes (e.g. DC/26-27/0765). */
export function deliveryChallanDetailPath(dcNumber) {
  if (!dcNumber) return '/sales-pipeline/delivery-challans';
  return `/sales-pipeline/delivery-challans/${encodeURIComponent(dcNumber)}`;
}

export function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export function lineTotal(line) {
  return (Number(line.rate) || 0) * (Number(line.quantity) || 0);
}

export function sumLines(lines) {
  return (lines || []).reduce((s, l) => s + lineTotal(l), 0);
}

export function formatConfig(line) {
  return [
    line.brand,
    line.model_name || line.model,
    line.processor,
    line.generation,
    line.ram,
    line.storage,
    line.gpu,
    line.screen_size,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function typeLabel(t) {
  const key = String(t || '').toLowerCase();
  if (key === 'sale' || key === 'sales') return 'Sales';
  if (key === 'demo') return 'Demo';
  if (key === 'rental') return 'Rental';
  return t || '—';
}

export function statusLabel(s) {
  if (!s) return '—';
  return String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function parseSerials(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const p = JSON.parse(raw);
    return Array.isArray(p) ? p : [p];
  } catch {
    return String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  }
}

export function countLaptops(lines) {
  return (lines || []).reduce((s, l) => s + (Number(l.quantity) || 0), 0);
}

export const GST_RATE = 18;
export const SELLER_STATE_CODE = '06';

export function normalizeStateForGst(state) {
  return String(state || '').trim().toLowerCase().replace(/\s+/g, '_');
}

/** Haryana (company state) → CGST+SGST; any other state → IGST. */
export function isIntraStateGst(supplyState) {
  const s = normalizeStateForGst(supplyState);
  if (!s) return true;
  if (s === '06' || s === 'hr') return true;
  if (s.includes('haryana')) return true;
  return false;
}

export function resolveSupplyStateFromShipping(shippingAddress, fallback = '') {
  if (!shippingAddress?.state || !String(shippingAddress.state).trim()) {
    return normalizeStateForGst(fallback);
  }
  return normalizeStateForGst(shippingAddress.state);
}

export function formatSupplyStateLabel(slug) {
  if (!slug) return '—';
  return String(slug).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** GST on goods subtotal only; shipping + security added after tax (matches backend). */
export function computeGstBreakdown({
  subtotal = 0, shipping = 0, security = 0, supplyState = '',
} = {}) {
  const sub = +Number(subtotal || 0).toFixed(2);
  const ship = +Number(shipping || 0).toFixed(2);
  const sec = +Number(security || 0).toFixed(2);
  const gstTotal = +(sub * GST_RATE / 100).toFixed(2);
  const intra = isIntraStateGst(supplyState);
  const half = +(gstTotal / 2).toFixed(2);
  return {
    subtotal: sub,
    gst_rate: GST_RATE,
    gst_type: intra ? 'intra' : 'inter',
    cgst: intra ? half : 0,
    sgst: intra ? +(gstTotal - half).toFixed(2) : 0,
    igst: intra ? 0 : gstTotal,
    gst_total: gstTotal,
    shipping: ship,
    security: sec,
    grand_total: +(sub + gstTotal + ship + sec).toFixed(2),
  };
}

/** Parse delivery/shipping address — handles JSON strings and nested/double-encoded JSON in `address`. */
function tryParseJsonString(s) {
  if (typeof s !== 'string') return undefined;
  const trimmed = s.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

function looksLikeEncodedJson(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  return t.startsWith('{')
    || t.startsWith('[')
    || t.startsWith('"')
    || t.includes('\\"');
}

function unwrapJsonValue(value, depth = 0) {
  if (value == null || depth > 6) return value;

  if (typeof value === 'string') {
    if (!looksLikeEncodedJson(value)) return value;
    const parsed = tryParseJsonString(value);
    if (parsed !== undefined) return unwrapJsonValue(parsed, depth + 1);
    const unescaped = value.replace(/\\"/g, '"').replace(/^"+|"+$/g, '').trim();
    if (unescaped !== value) {
      const parsed2 = tryParseJsonString(unescaped);
      if (parsed2 !== undefined) return unwrapJsonValue(parsed2, depth + 1);
    }
    return value;
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    const out = { ...value };
    if (typeof out.address === 'string' && looksLikeEncodedJson(out.address)) {
      const unwrapped = unwrapJsonValue(out.address, depth + 1);
      if (typeof unwrapped === 'object' && unwrapped !== null && !Array.isArray(unwrapped)) {
        Object.assign(out, unwrapped);
      } else if (typeof unwrapped === 'string' && !looksLikeEncodedJson(unwrapped)) {
        out.address = unwrapped;
      }
    }
    if (out.zip_code && !out.pincode) out.pincode = out.zip_code;
    return out;
  }

  return value;
}

export function parseDeliveryAddress(raw) {
  if (raw == null) return null;
  const unwrapped = unwrapJsonValue(raw);
  if (typeof unwrapped !== 'object' || unwrapped == null || Array.isArray(unwrapped)) {
    return typeof unwrapped === 'string' && unwrapped.trim()
      ? { address: unwrapped.trim() }
      : null;
  }
  return unwrapped;
}

export function formatDeliveryAddressLine(raw) {
  const a = parseDeliveryAddress(raw);
  if (!a) return null;
  const line = [a.address, a.city, a.state, a.pincode || a.zip_code]
    .filter((part) => part && !looksLikeEncodedJson(String(part)))
    .join(', ');
  return line || null;
}

export function deliveryAddressPhone(raw, fallback = '') {
  const a = parseDeliveryAddress(raw);
  return a?.phone || fallback || '';
}

export function formatActivityDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function relativeTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}
