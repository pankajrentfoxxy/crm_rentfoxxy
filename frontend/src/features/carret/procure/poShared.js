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

export const lineConfig = (l) => [l.brand, l.model || l.model_name, l.processor, l.generation, l.ram, l.storage, l.gpu, l.screen_size]
  .filter(Boolean).join(' · ');

export function poQty(po) {
  const lines = Array.isArray(po?.line_items) ? po.line_items : [];
  return lines.reduce((a, l) => ({
    ordered: a.ordered + (Number(l.quantity) || 0),
    received: a.received + (Number(l.receivedQty) || 0),
  }), { ordered: 0, received: 0 });
}

/** Opens the PO PDF (authenticated fetch, then a blob tab). */
export async function openPoPdf(poId) {
  const w = window.open('', '_blank');
  const res = await api.get(`${PO_BASE}/${poId}/pdf`, { responseType: 'blob' });
  const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
  if (w) w.location.href = url; else window.location.href = url;
}

export const backendFile = (p) => (p ? `${getBackendOrigin().replace(/\/$/, '')}/${String(p).replace(/^\//, '')}` : null);

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
