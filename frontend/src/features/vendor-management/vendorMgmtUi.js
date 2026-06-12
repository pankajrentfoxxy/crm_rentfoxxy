/** Shared design tokens & helpers for vendor management UI */

export const VM_COLORS = {
  primary: '#2563EB',
  success: '#16A34A',
  warning: '#D97706',
  danger: '#DC2626'
};

/** Models per brand when laptop_catalog is empty (fresh DB / Railway) */
export const MODELS_BY_BRAND = {
  Dell: [
    'Latitude 5400',
    'Latitude 5410',
    'Latitude 5420',
    'Latitude 5430',
    'Latitude 7440',
    'Inspiron 15 3000',
    'Inspiron 15 5000',
    'XPS 13',
    'XPS 15',
    'Precision 3550',
    'Precision 5560',
    'Other'
  ],
  HP: [
    'EliteBook 840 G6',
    'EliteBook 840 G7',
    'EliteBook 840 G8',
    'EliteBook 850 G8',
    'ProBook 440 G8',
    'ProBook 450 G8',
    'Pavilion 15',
    'ZBook Firefly 14',
    'ZBook Studio',
    'Other'
  ],
  Lenovo: [
    'ThinkPad T14',
    'ThinkPad T14s',
    'ThinkPad L14',
    'ThinkPad X1 Carbon',
    'ThinkPad E14',
    'IdeaPad 3',
    'IdeaPad 5',
    'Legion 5',
    'Yoga 7i',
    'Other'
  ],
  Apple: [
    'MacBook Air M1',
    'MacBook Air M2',
    'MacBook Air M3',
    'MacBook Pro 13',
    'MacBook Pro 14',
    'MacBook Pro 16',
    'Other'
  ],
  Asus: ['VivoBook 15', 'ZenBook 14', 'ExpertBook B1', 'ROG Strix', 'Other'],
  Acer: ['Aspire 5', 'Aspire 7', 'Swift 3', 'TravelMate P2', 'Spin 5', 'Other'],
  MSI: ['Modern 14', 'Prestige 14', 'GF63', 'Other'],
  Samsung: ['Galaxy Book2', 'Galaxy Book3', 'Other'],
  Toshiba: ['Portégé X30', 'Tecra A50', 'Other'],
  Other: ['Other']
};

const FALLBACK_MODELS_FLAT = [...new Set(Object.values(MODELS_BY_BRAND).flat())];

export const FALLBACK_ASSET_CATALOG = {
  brands: ['Dell', 'HP', 'Lenovo', 'Apple', 'Asus', 'Acer', 'MSI', 'Samsung', 'Toshiba', 'Other'],
  models: FALLBACK_MODELS_FLAT,
  processors: [
    'Intel Core i3',
    'Intel Core i5',
    'Intel Core i7',
    'Intel Core i9',
    'AMD Ryzen 3',
    'AMD Ryzen 5',
    'AMD Ryzen 7',
    'Apple M1',
    'Apple M2',
    'Apple M3'
  ],
  generations: [
    '6th Gen',
    '7th Gen',
    '8th Gen',
    '9th Gen',
    '10th Gen',
    '11th Gen',
    '12th Gen',
    '13th Gen',
    '14th Gen'
  ],
  rams: ['4 GB', '8 GB', '12 GB', '16 GB', '24 GB', '32 GB', '64 GB'],
  storages: [
    '128 GB SSD',
    '256 GB SSD',
    '512 GB SSD',
    '1 TB SSD',
    '256 GB HDD',
    '512 GB HDD',
    '1 TB HDD'
  ],
  gpus: [
    'Integrated',
    'NVIDIA GTX 1650',
    'NVIDIA RTX 3050',
    'NVIDIA RTX 3060',
    'NVIDIA RTX 4060',
    'AMD Radeon RX',
    'Other Dedicated'
  ],
  screen_sizes: ['11.6"', '13.3"', '14"', '15.6"', '16"', '17.3"']
};

export function mergeAssetCatalog(apiCatalog) {
  const c = apiCatalog || {};
  const pick = (key, fallbackKey) => {
    const arr = c[key] ?? c[fallbackKey];
    return Array.isArray(arr) && arr.length > 0 ? arr : FALLBACK_ASSET_CATALOG[fallbackKey || key];
  };
  return {
    brands: pick('brands', 'brands'),
    models: pick('models', 'models'),
    models_by_brand: c.models_by_brand || MODELS_BY_BRAND,
    processors: pick('processors', 'processors'),
    generations: pick('generations', 'generations'),
    rams: pick('rams', 'rams'),
    storages: pick('storages', 'storages'),
    gpus: pick('gpus', 'gpus'),
    screen_sizes: pick('screen_sizes', 'screen_sizes')
  };
}

/** Model dropdown options for selected brand (API catalog or fallbacks). */
export function modelsForBrand(brand, catalog) {
  const b = String(brand || '').trim();
  const byBrand = catalog?.models_by_brand || MODELS_BY_BRAND;
  if (b && byBrand[b]?.length) {
    return byBrand[b];
  }
  if (Array.isArray(catalog?.models) && catalog.models.length > 0) {
    return catalog.models;
  }
  return FALLBACK_MODELS_FLAT;
}

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
