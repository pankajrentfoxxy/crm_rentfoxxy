/**
 * Customer type (sales / rental / both) — eligibility helpers.
 */

const CUSTOMER_TYPES = Object.freeze(['sales', 'rental', 'both']);

function normalizeCustomerType(value) {
  const t = String(value || 'both').trim().toLowerCase();
  return CUSTOMER_TYPES.includes(t) ? t : 'both';
}

function canEditCustomerType(user) {
  const role = String(user?.role || '').toLowerCase();
  return role === 'admin' || role === 'super_admin';
}

/** Map quotation_type → filter key used by listCustomers (?customer_type=). */
function customerTypeFilterForQuotation(quotationType) {
  const qt = String(quotationType || 'rental').trim().toLowerCase();
  if (qt === 'sale' || qt === 'sales') return 'sales';
  return 'rental'; // rental + demo
}

function isCustomerEligibleForQuotation(customerType, quotationType) {
  const ct = normalizeCustomerType(customerType);
  if (ct === 'both') return true;
  const filter = customerTypeFilterForQuotation(quotationType);
  return ct === filter;
}

function customerTypeMismatchMessage(customerType, quotationType) {
  const filter = customerTypeFilterForQuotation(quotationType);
  if (filter === 'sales') {
    return 'This customer is Rental-only; cannot create a Sales order.';
  }
  return 'This customer is Sales-only; cannot create a Rental order.';
}

/** SQL fragment: c.customer_type eligible for sales|rental filter (Both included). */
function customerTypeSqlCondition(filter, column = 'c.customer_type') {
  const f = String(filter || '').trim().toLowerCase();
  if (f === 'sales') return `${column} IN ('sales', 'both')`;
  if (f === 'rental') return `${column} IN ('rental', 'both')`;
  return null;
}

module.exports = {
  CUSTOMER_TYPES,
  normalizeCustomerType,
  canEditCustomerType,
  customerTypeFilterForQuotation,
  isCustomerEligibleForQuotation,
  customerTypeMismatchMessage,
  customerTypeSqlCondition,
};
