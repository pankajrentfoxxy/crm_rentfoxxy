/**
 * Shared bits for the Carret repair challan (VRDC) screens — Procurement →
 * Vendor returns. Same rules and endpoints as the old Vendor Repair DC pages
 * (features/floor-pipeline/pages/VendorRepairDc*.jsx); only the screen is new.
 */
import { getBackendOrigin } from '../../../utils/api';

/**
 * Roles the backend's requireWarehouse / requireVendorRepairDispatch accept
 * (services/vendorRepairDcService.js WAREHOUSE_ROLES). Receive, price/HSN,
 * replacement check and "vendor keeps it" are role-only on the server.
 */
export const REPAIR_WAREHOUSE_ROLES = new Set(['warehouse', 'admin', 'manager', 'super_admin', 'floor_manager', 'support_lead']);

export const VRDC_STATUS_LABEL = {
  draft: 'Draft',
  dispatch_ready: 'At the gate',
  dispatched: 'With the vendor',
  partially_returned: 'Part back',
  returned: 'All back',
  cancelled: 'Cancelled',
};

/** Document-status family for StatusChip (it has no VRDC words of its own). */
export const vrdcChip = (s) => ({
  draft: 'draft', dispatch_ready: 'pending', dispatched: 'dispatched', partially_returned: 'partial', returned: 'completed', cancelled: 'cancelled',
}[s] || 'processing');

export const ITEM_STATUS_LABEL = {
  draft: 'Not sent yet',
  dispatch_ready: 'At the gate',
  dispatched: 'With the vendor',
  gate_received: 'Back at our gate',
  received: 'Received (repaired)',
  replacement_received: 'Replacement received',
  replacement_pending: 'Replacement — waiting for approval',
  vendor_kept: 'Vendor kept it',
  cancelled: 'Cancelled',
};
export const itemStatusLabel = (s) => ITEM_STATUS_LABEL[s || 'draft'] || String(s || '').replace(/_/g, ' ');

export const SHIP_LABEL = { by_hand: 'In-house', by_courier: 'Courier', by_porter: 'Porter', by_vendor_pickup: 'Vendor pickup' };

/** The old dispatch_mode column → ship_by, for challans made before ship_by existed. */
export function shipByOf(dc) {
  if (!dc) return '';
  if (dc.ship_by) return dc.ship_by;
  return { inhouse: 'by_hand', porter: 'by_porter', courier: 'by_courier', vendor_pickup: 'by_vendor_pickup' }[dc.dispatch_mode] || '';
}

/** Transport form fields as the server stores them (same keys the old page sent). */
export function transportFieldsOf(dc) {
  return {
    courier_name: dc?.courier_name || '',
    awb_number: dc?.awb_number || '',
    courier_tracking_url: dc?.courier_tracking_url || '',
    porter_tracking_id: dc?.porter_tracking_id || '',
    porter_order_id: dc?.porter_order_id || '',
    porter_booking_url: dc?.porter_booking_url || '',
    delivery_person_id: dc?.delivery_person_id ? String(dc.delivery_person_id) : '',
    vehicle_number: dc?.vehicle_number || '',
    vendor_pickup_person: dc?.vendor_pickup_person || '',
    vendor_pickup_mobile: dc?.vendor_pickup_mobile || '',
    porter_person_name: dc?.porter_person_name || '',
    porter_person_phone: dc?.porter_person_phone || '',
    delivery_person_phone: dc?.inhouse_person_phone || dc?.delivery_person_phone || '',
  };
}

export function transportLine(dc) {
  const sb = shipByOf(dc);
  if (sb === 'by_courier') return [dc.courier_name, dc.awb_number && `AWB ${dc.awb_number}`].filter(Boolean).join(' · ');
  if (sb === 'by_porter') return [dc.porter_person_name, dc.porter_person_phone, dc.vehicle_number, dc.porter_tracking_id && `booking ${dc.porter_tracking_id}`, dc.porter_order_id && `order ${dc.porter_order_id}`].filter(Boolean).join(' · ');
  if (sb === 'by_vendor_pickup') return [dc.vendor_pickup_person, dc.vendor_pickup_mobile, dc.vehicle_number].filter(Boolean).join(' · ');
  if (sb === 'by_hand') return [dc.delivery_person_name, dc.inhouse_person_phone || dc.delivery_person_phone, dc.vehicle_number].filter(Boolean).join(' · ');
  return '';
}

/** Signatures / POD photos are stored under /uploads (same rule as the old page). */
export function uploadUrl(p) {
  if (!p) return null;
  if (/^(https?:|data:)/i.test(p)) return p;
  return `${getBackendOrigin().replace(/\/$/, '')}/uploads/${String(p).replace(/^\/?uploads\//, '')}`;
}

/** E-way documents are stored as a path relative to the backend origin. */
export function docUrl(p) {
  if (!p) return null;
  if (/^https?:/i.test(p)) return p;
  return `${getBackendOrigin().replace(/\/$/, '')}/${String(p).replace(/^\//, '')}`;
}

export const prettyYmd = (ymd) => (ymd ? new Date(`${String(ymd).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
export const ymdOf = (v) => (v ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(v)) : '');

/** Read an image file into a data URL (≤ 5 MB), as the old dispatch-proof upload did. */
export function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!file) { resolve(null); return; }
    if (file.size > 5 * 1024 * 1024) { reject(new Error('Image must be under 5 MB')); return; }
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Could not read the image'));
    r.readAsDataURL(file);
  });
}
