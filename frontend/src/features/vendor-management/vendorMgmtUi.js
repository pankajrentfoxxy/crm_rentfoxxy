/** Shared design tokens & helpers for vendor management UI */

export const VM_COLORS = {
  primary: '#2563EB',
  success: '#16A34A',
  warning: '#D97706',
  danger: '#DC2626'
};

export {
  mergeAssetCatalog,
  modelsForBrand,
  generationsForProcessor,
  EMPTY_ASSET_CATALOG,
} from '../../utils/assetCatalogUtils';

export function vendorStatusKey(row) {
  const s = String(row?.status || '').toLowerCase();
  if (s === 'approved') return 'active';
  if (s === 'pending') return 'pending';
  if (s === 'suspended') return 'suspended';
  return 'pending';
}

export function vendorStatusLabel(key) {
  if (key === 'active') return 'Active';
  if (key === 'pending') return 'Pending';
  if (key === 'suspended') return 'Suspended';
  return 'Pending';
}

export function paymentTermsLabel(terms) {
  const t = String(terms || '').toLowerCase();
  if (t === 'postpaid_monthly') return 'Postpaid Monthly';
  if (t === 'net30') return 'Net 30';
  if (t === 'net15') return 'Net 15';
  if (t === 'advance') return 'Advance';
  return terms || '—';
}

export function paymentTermsBadgeClass(terms) {
  const t = String(terms || '').toLowerCase();
  if (t === 'postpaid_monthly') return 'bg-blue-50 text-blue-700';
  if (t === 'net30') return 'bg-purple-50 text-purple-700';
  if (t === 'net15') return 'bg-indigo-50 text-indigo-700';
  if (t === 'advance') return 'bg-amber-50 text-amber-800';
  return 'bg-gray-100 text-gray-600';
}

export function poTypeBadge(type) {
  const s = String(type || '').toLowerCase();
  if (s === 'rent_to_own') return { label: 'Rent to Own', className: 'bg-[#F3F0FF] text-[#5B21B6]' };
  if (s === 'direct_purchase') return { label: 'Direct Purchase', className: 'bg-[#EFF6FF] text-[#1D4ED8]' };
  if (s === 'rental_purchase') return { label: 'Rental', className: 'bg-[#F0FDFA] text-[#0F766E]' };
  return { label: type || '—', className: 'bg-gray-100 text-gray-600' };
}

export function poStatusBadge(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'draft' || s === 'pending' || s === '') return { label: 'Draft', className: 'bg-gray-100 text-gray-700' };
  if (s === 'pending_approval') return { label: 'Awaiting Approval', className: 'bg-amber-50 text-amber-800' };
  if (s === 'approved') return { label: 'Approved', className: 'bg-green-50 text-green-700' };
  if (s === 'vendor_accepted') return { label: 'Vendor Accepted', className: 'bg-emerald-50 text-emerald-800' };
  if (s === 'vendor_rejected') return { label: 'Vendor Rejected', className: 'bg-red-50 text-red-700' };
  if (s === 'sent') return { label: 'Sent to Vendor', className: 'bg-teal-50 text-teal-800' };
  if (s === 'processing') return { label: 'Processing', className: 'bg-blue-50 text-blue-700' };
  if (s === 'completed') return { label: 'Completed', className: 'bg-slate-100 text-slate-700' };
  if (s === 'rejected') return { label: 'Rejected', className: 'bg-red-50 text-red-700' };
  return { label: s.replace(/_/g, ' '), className: 'bg-gray-100 text-gray-600' };
}

export function isManagerUser(user) {
  if (!user) return false;
  if (user.is_superadmin) return true;
  const role = String(user.role || '').toLowerCase();
  return ['manager', 'admin', 'super_admin'].includes(role);
}

export function isProcurementUser(user) {
  if (!user) return false;
  if (user.is_superadmin) return true;
  const role = String(user.role || '').toLowerCase();
  return ['procurement', 'admin', 'super_admin', 'manager'].includes(role);
}

export function formatStateLabel(state) {
  if (!state) return '—';
  return String(state)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
