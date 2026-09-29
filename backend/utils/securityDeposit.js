/**
 * Security deposit types on quotations / sales orders: none, or 1 / 2 / 3
 * months of the line's monthly rent (two_month_rental and three_month_rental
 * since migration 407). Anything else is a fixed security_amount on the lines.
 */
const SECURITY_MONTHS = { none: 0, one_month_rental: 1, two_month_rental: 2, three_month_rental: 3 };

function securityMonths(type) {
  return SECURITY_MONTHS[String(type || '').toLowerCase()] || 0;
}

function securityTypeForMonths(months) {
  const m = Math.trunc(Number(months) || 0);
  return Object.keys(SECURITY_MONTHS).find((k) => SECURITY_MONTHS[k] === m) || 'none';
}

module.exports = { SECURITY_MONTHS, securityMonths, securityTypeForMonths };
