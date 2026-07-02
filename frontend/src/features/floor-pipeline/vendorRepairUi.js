/** TRUETECH billing block — kept in sync with backend/utils/companyDefaults.js */
export const DEFAULT_BILLING_ADDRESS = `TRUETECH SERVICES PRIVATE LIMITED
Email: accounts@truetechservices.in
GSTIN: 06AAHCT0310N1ZG
Address: 429, 4th Floor, JMD Megapolis Building, Sohna Road, Gurgaon, Haryana - 06`;

export function fmtVendorRepairDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString('en-IN');
}

/** Registered / billing address lines from a vendor master record. */
export function formatVendorBillingFromVendor(vendor, { includeName = true } = {}) {
  if (!vendor) return '';
  const lines = [];
  if (includeName) {
    const name = vendor.business_name || vendor.f_name || vendor.vendor_name;
    if (name) lines.push(name);
  }
  const street = [
    vendor.address,
    vendor.city,
    vendor.state_label || vendor.state,
    vendor.pincode,
  ].filter(Boolean).join(', ');
  if (street) lines.push(street);
  return lines.join('\n');
}

/** Shipping address from vendor master (falls back to registered when shipping_same). */
export function formatVendorShippingFromVendor(vendor, { includeName = true } = {}) {
  if (!vendor) return '';
  if (vendor.shipping_same !== false) {
    return formatVendorBillingFromVendor(vendor, { includeName });
  }
  const lines = [];
  if (includeName) {
    const name = vendor.business_name || vendor.f_name || vendor.vendor_name;
    if (name) lines.push(name);
  }
  const street = [
    vendor.shipping_address,
    vendor.shipping_city,
    vendor.shipping_state_label || vendor.shipping_state,
    vendor.shipping_pincode,
  ].filter(Boolean).join(', ');
  if (street) lines.push(street);
  return lines.join('\n');
}

export function vendorRepairStatusLabel(status) {
  const map = {
    draft: 'Draft',
    dispatched: 'Dispatched',
    partially_returned: 'Partially Returned',
    returned: 'Returned',
  };
  return map[status] || String(status || '—').replace(/_/g, ' ');
}

export function vendorRepairStatusClass(status) {
  if (status === 'draft') return 'bg-slate-100 text-slate-700';
  if (status === 'dispatched') return 'bg-purple-100 text-purple-900';
  if (status === 'partially_returned') return 'bg-amber-100 text-amber-900';
  if (status === 'returned') return 'bg-green-100 text-green-800';
  return 'bg-slate-100 text-slate-700';
}
