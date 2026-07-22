/** Customer type helpers (sales / rental / both) — mirrors backend/utils/customerType.js */

export const CUSTOMER_TYPE_OPTIONS = [
  { value: 'both', label: 'Both' },
  { value: 'sales', label: 'Sales' },
  { value: 'rental', label: 'Rental' },
];

export function normalizeCustomerType(value) {
  const t = String(value || 'both').trim().toLowerCase();
  return ['sales', 'rental', 'both'].includes(t) ? t : 'both';
}

export function customerTypeLabel(value) {
  const t = normalizeCustomerType(value);
  if (t === 'sales') return 'Sales';
  if (t === 'rental') return 'Rental';
  return 'Both';
}

export function customerTypeBadgeClass(value) {
  const t = normalizeCustomerType(value);
  if (t === 'sales') return 'bg-indigo-100 text-indigo-800';
  if (t === 'rental') return 'bg-teal-100 text-teal-800';
  return 'bg-slate-100 text-slate-700';
}

export function isCustomerEligibleForQuotation(customerType, quotationType) {
  const ct = normalizeCustomerType(customerType);
  if (ct === 'both') return true;
  const qt = String(quotationType || 'rental').trim().toLowerCase();
  if (qt === 'sale' || qt === 'sales') return ct === 'sales';
  return ct === 'rental';
}

export function customerTypeMismatchMessage(customerType, quotationType) {
  const qt = String(quotationType || 'rental').trim().toLowerCase();
  if (qt === 'sale' || qt === 'sales') {
    return 'This customer is Rental-only; cannot create a Sales order.';
  }
  return 'This customer is Sales-only; cannot create a Rental order.';
}

export function filterCustomersForQuotation(customers, quotationType) {
  return (customers || []).filter((c) =>
    isCustomerEligibleForQuotation(c.customer_type, quotationType)
  );
}
