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

export function fmtVendorRepairDateTimeIst(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function parseVrdcItemConfig(item) {
  const parts = String(item?.configuration || '').split('·').map((s) => s.trim()).filter((p) => p && p !== '-');
  let brand = '';
  let model = '';
  let processor = '';
  let generation = '';
  let ram = '';
  let storage = '';
  if (parts.length >= 6) {
    [brand, model, processor, generation, ram, storage] = parts;
  } else if (parts.length === 5) {
    [brand, model, processor, ram, storage] = parts;
  } else {
    brand = parts[0] || '';
    model = parts[1] || '';
    processor = parts[2] || '';
    generation = parts[3] || '';
    ram = parts[4] || '';
    storage = parts[5] || '';
  }
  const combined = `${brand} ${model}`.toLowerCase();
  if (/macbook|mac book|\bimac\b|mac mini|mac studio|\bmac pro\b/.test(combined)) {
    brand = 'Apple';
    model = model.replace(/^dell\s+/i, '').replace(/^apple\s+/i, '');
  }
  return { brand, model, processor, generation, ram, storage };
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

export function formatVrdcProductLines(item) {
  const cfg = parseVrdcItemConfig(item);
  const title = `${cfg.brand} ${cfg.model}`.replace(/\s+/g, ' ').trim();
  const specs = [
    [cfg.processor, cfg.generation].filter((v) => v && v !== '-').join(' | '),
    [cfg.ram, cfg.storage].filter(Boolean).join(' | '),
  ].filter(Boolean);
  const ids = [item?.serial_number, item?.ttspl_id].filter(Boolean).join(' · ');
  return { title, specs, ids };
}

export function vendorRepairDispatchModeLabel(shipBy, dispatchMode) {
  const v = shipBy || dispatchMode;
  if (v === 'by_hand' || v === 'inhouse') return 'By Hand';
  if (v === 'by_courier' || v === 'courier') return 'By Courier';
  if (v === 'by_porter' || v === 'porter') return 'By Porter';
  return '—';
}

export function vendorDeliveryStatusLabel(dc) {
  if (dc?.vendor_delivered_at || dc?.vendor_delivery_status === 'delivered') return 'Delivered to Vendor';
  if (dc?.dispatched_at || dc?.status === 'dispatched' || dc?.vendor_delivery_status === 'in_transit') {
    return 'In Transit to Vendor';
  }
  return 'Pending Dispatch';
}

export function vendorDeliveryStatusClass(dc) {
  if (dc?.vendor_delivered_at || dc?.vendor_delivery_status === 'delivered') {
    return 'bg-green-100 text-green-800';
  }
  if (dc?.dispatched_at || dc?.status === 'dispatched' || dc?.vendor_delivery_status === 'in_transit') {
    return 'bg-blue-100 text-blue-800';
  }
  return 'bg-slate-100 text-slate-700';
}

export function vendorRepairStatusLabel(status) {
  const map = {
    draft: 'Draft',
    dispatch_ready: 'Dispatch Ready',
    dispatched: 'Dispatched',
    partially_returned: 'Partially Returned',
    returned: 'Returned',
  };
  return map[status] || String(status || '—').replace(/_/g, ' ');
}

export function vendorRepairStatusClass(status) {
  if (status === 'draft') return 'bg-slate-100 text-slate-700';
  if (status === 'dispatch_ready') return 'bg-sky-100 text-sky-800';
  if (status === 'dispatched') return 'bg-purple-100 text-purple-900';
  if (status === 'partially_returned') return 'bg-amber-100 text-amber-900';
  if (status === 'returned') return 'bg-green-100 text-green-800';
  return 'bg-slate-100 text-slate-700';
}
