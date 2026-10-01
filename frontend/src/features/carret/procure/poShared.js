/** Shared bits for the Carret purchase-order screens. */
import api, { getBackendOrigin } from '../../../utils/api';

export const PO_BASE = '/vendor-management/purchase-orders';

/** What each status means to the team (the chip label). */
export const PO_STATUS_LABEL = {
  draft: 'Draft',
  pending: 'Draft',
  pending_approval: 'Waiting approval',
  rejected: 'Rejected',
  approved: 'Sent to vendor',
  sent: 'Sent to vendor',
  vendor_accepted: 'Vendor accepted',
  vendor_rejected: 'Vendor declined',
  processing: 'Receiving',
  completed: 'Received',
  closed: 'Short-closed',
  cancelled: 'Cancelled',
};
export const poStatus = (po) => String(po?.status || 'draft').toLowerCase();
export const poStatusLabel = (s) => PO_STATUS_LABEL[String(s || 'draft').toLowerCase()] || s;

/** List tabs: each is a set of statuses. */
export const PO_TABS = [
  { key: 'open', label: 'Open', statuses: ['draft', 'pending', 'pending_approval', 'rejected', 'vendor_rejected', 'approved', 'sent', 'vendor_accepted', 'processing'] },
  { key: 'approval', label: 'Waiting approval', statuses: ['pending_approval'] },
  { key: 'draft', label: 'Draft / sent back', statuses: ['draft', 'pending', 'rejected', 'vendor_rejected'] },
  { key: 'vendor', label: 'With vendor', statuses: ['approved', 'sent', 'vendor_accepted'] },
  { key: 'receiving', label: 'Receiving', statuses: ['processing'] },
  { key: 'done', label: 'Done', statuses: ['completed', 'closed'] },
  { key: 'cancelled', label: 'Cancelled', statuses: ['cancelled'] },
  { key: 'all', label: 'All', statuses: [] },
];

export const PO_TYPES = [
  { value: 'rental_purchase', label: 'Rental' },
  { value: 'rent_to_own', label: 'Rent to own' },
  { value: 'direct_purchase', label: 'Purchase' },
];
export const poTypeLabel = (t) => PO_TYPES.find((x) => x.value === t)?.label || String(t || '—').replace(/_/g, ' ');
export const isRentalType = (t) => ['rental_purchase', 'rent_to_own'].includes(String(t || '').toLowerCase());

/** What a line costs per unit: on a rental PO the monthly rent (D3), else the rate. */
export const lineRate = (l, type) => (isRentalType(type) && Number(l?.monthly_rental_amount) > 0 ? Number(l.monthly_rental_amount) : (Number(l?.rate) || 0));

export const lineConfig = (l) => [l.brand, l.model || l.model_name, l.processor, l.generation, l.ram, l.storage, l.gpu, l.screen_size]
  .filter(Boolean).join(' · ');

export function poQty(po) {
  const lines = Array.isArray(po?.line_items) ? po.line_items : [];
  return lines.reduce((a, l) => ({
    ordered: a.ordered + (Number(l.quantity) || 0),
    received: a.received + (Number(l.receivedQty ?? l.received_qty) || 0),
  }), { ordered: 0, received: 0 });
}

/** Opens the PO PDF (authenticated fetch, then a blob tab). */
export async function openPoPdf(poId) {
  const w = window.open('', '_blank');
  let res;
  try {
    res = await api.get(`${PO_BASE}/${poId}/pdf`, { responseType: 'blob' });
  } catch (e) {
    if (w) w.close();
    throw e;
  }
  const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
  if (w) w.location.href = url; else window.location.href = url;
  // On the PO's activity, like the old screen. Not awaited: logging never holds up the PDF.
  logPoDocument(poId, 'pdf_downloaded');
}

export const backendFile = (p) => (p ? `${getBackendOrigin().replace(/\/$/, '')}/${String(p).replace(/^\//, '')}` : null);

/* ---------- bills / vendor invoice files ---------- */
/** bill_files arrives as a JSON array (or, on old rows, a JSON string) of paths or {path,name} objects. */
export function parseBillFiles(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'string') {
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p.filter(Boolean) : []; } catch { return []; }
  }
  return [];
}
export const billFilePath = (f) => (!f ? '' : (typeof f === 'string' ? f : String(f.path || f.url || f.file || f.filename || '')));
export const billFileName = (f) => (typeof f === 'string' ? (f.split('/').pop() || 'File') : (f?.name || f?.filename || billFilePath(f).split('/').pop() || 'File'));
/** A full URL for an uploaded file (an absolute URL is kept as it is). */
export function billFileUrl(f) {
  const p = billFilePath(f);
  if (!p) return null;
  return /^https?:\/\//i.test(p) ? p : backendFile(p);
}
/**
 * What bill a PO carries: the CRM upload (bill_name + bill_files) first, then
 * the vendor's portal upload (vendor_invoice_number / vendor_invoice_file).
 */
export function poBillInfo(po) {
  const files = parseBillFiles(po?.bill_files);
  if (po?.bill_name || files.length) return { name: po?.bill_name || 'Bill', files, source: 'crm' };
  if (po?.vendor_invoice_number || po?.vendor_invoice_file) {
    return { name: po.vendor_invoice_number || 'Vendor invoice', files: po.vendor_invoice_file ? [po.vendor_invoice_file] : [], source: 'vendor' };
  }
  return { name: null, files: [], source: null };
}
/** Bills are uploaded once the PO has gone to the vendor (as the old screen did), plus short-closed POs. */
export const BILL_STATES = ['approved', 'sent', 'vendor_accepted', 'processing', 'completed', 'closed'];

export const isSuperAdmin = (user) => user?.role === 'super_admin' || user?.is_superadmin === true;

/** Logs a PO document action (pdf_downloaded | printed | shared). Best-effort: never throws. */
export function logPoDocument(poId, action = 'pdf_downloaded') {
  return api.post(`${PO_BASE}/${poId}/activities`, { action }).catch(() => null);
}

/* ---------- spare-parts POs (D13: same flow, their own statuses) ---------- */
export const SPO_BASE = '/vendor-management/spare-parts-orders';
// On a spare PO "pending" means submitted, waiting for approval.
export const spoStatusLabel = (s) => (String(s || '').toLowerCase() === 'pending' ? 'Waiting approval' : poStatusLabel(s));
export const SPO_TABS = [
  { key: 'open', label: 'Open', statuses: ['draft', 'pending', 'rejected', 'approved', 'processing'] },
  { key: 'approval', label: 'Waiting approval', statuses: ['pending'] },
  { key: 'draft', label: 'Draft / sent back', statuses: ['draft', 'rejected'] },
  { key: 'vendor', label: 'With vendor', statuses: ['approved'] },
  { key: 'receiving', label: 'Receiving', statuses: ['processing'] },
  { key: 'done', label: 'Done', statuses: ['completed', 'closed'] },
  { key: 'cancelled', label: 'Cancelled', statuses: ['cancelled'] },
  { key: 'all', label: 'All', statuses: [] },
];
export const spareLineName = (l) => [l.spare_part_name || l.part_name, l.brand_name && l.brand_name !== 'Any' ? l.brand_name : null, l.model_name, l.specifications && l.specifications !== l.category ? l.specifications : null]
  .filter(Boolean).join(' · ');
