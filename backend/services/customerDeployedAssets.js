/**
 * Shared rules for "assets deployed / held by a customer".
 *
 * Canonical CRM statuses: rented, on_demo, sold (+ reserved, in_transit while allocated).
 * ERP migration legacy: out_stock (customer_rent_devices / serial_numbers.status2).
 */
const DEPLOYED_WITH_CUSTOMER_STATUSES = Object.freeze([
  'rented',
  'on_demo',
  'sold',
  'reserved',
  'dispatch_ready',
  'in_transit',
  'out_stock', // ERP legacy — deployed with customer
]);

/** UI-facing status (normalize legacy ERP values). */
function displayDeployedStatus(status) {
  if (status === 'out_stock') return 'rented';
  return status || 'rented';
}

/** SQL fragment: `$N` must be a text[] param of DEPLOYED_WITH_CUSTOMER_STATUSES */
function deployedStatusFilterSql(column, paramRef) {
  return `${column} = ANY(${paramRef}::text[])`;
}

module.exports = {
  DEPLOYED_WITH_CUSTOMER_STATUSES,
  displayDeployedStatus,
  deployedStatusFilterSql,
};
