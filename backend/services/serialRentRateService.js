const pool = require('../config/db');

/**
 * Monthly rent for a serial from its sales-order allocation (authoritative for DC billing).
 */
async function resolveSerialRentRate(db, serialId, dcNumber = null) {
  if (!serialId) return null;
  const client = db || pool;
  const params = [serialId];
  let dcClause = '';
  if (dcNumber) {
    params.push(String(dcNumber));
    dcClause = `AND sos.dc_number = $${params.length}`;
  }
  // A replacement carries the returned laptop's rate (recorded on the
  // replacement order), whatever its SO line was later edited to.
  const bySerial = await client.query(
    `SELECT COALESCE(NULLIF(ro.old_rent_monthly_rate, 0), sol.rate) AS rate
       FROM sales_order_serials sos
       JOIN sales_order_lines sol ON sol.id = sos.line_id
       LEFT JOIN support_replacement_orders ro
         ON ro.sales_order_line_id = sol.id AND ro.status <> 'cancelled'
      WHERE sos.serial_id = $1
        AND sos.status <> 'removed'
        ${dcClause}
      ORDER BY sos.allocation_id DESC
      LIMIT 1`,
    params
  );
  const serialRate = parseFloat(bySerial.rows[0]?.rate || 0);
  if (serialRate > 0) return serialRate;

  if (!dcNumber) return null;
  const byDc = await client.query(
    `SELECT sol.rate
       FROM delivery_challan_lines dcl
       JOIN sales_order_lines sol ON sol.sales_order_number = dcl.sales_order_number
      WHERE dcl.dc_number = $1
      ORDER BY (sol.brand = dcl.brand) DESC NULLS LAST, sol.id ASC
      LIMIT 1`,
    [dcNumber]
  );
  const dcRate = parseFloat(byDc.rows[0]?.rate || 0);
  return dcRate > 0 ? dcRate : null;
}

/**
 * The monthly rent THIS customer agreed for this laptop: the rate on the
 * customer's own rental sales-order line the unit was allocated to (the DC's
 * SO when dcNumber is given, else the latest). A laptop's
 * vendor_serial_numbers.rent_monthly_rate is one field that outlives each
 * rental, so on a re-rented unit it can still hold the previous customer's
 * rate; the SO line cannot. A replacement's line takes the returned laptop's
 * rate from its replacement order. Rs 1 placeholders (demo, draft SOs) don't count.
 * Returns null when the customer has no such line for the unit.
 */
async function resolveCustomerContractRate(db, serialId, customerId, { dcNumber = null } = {}) {
  if (!serialId || !customerId) return null;
  const client = db || pool;
  const params = [serialId, customerId];
  let dcClause = '';
  if (dcNumber) {
    params.push(String(dcNumber));
    dcClause = `AND sos.dc_number = $${params.length}`;
  }
  const r = await client.query(
    `SELECT COALESCE(NULLIF(ro.old_rent_monthly_rate, 0), sol.rate) AS rate
       FROM sales_order_serials sos
       JOIN sales_order_lines sol ON sol.id = sos.line_id
       LEFT JOIN support_replacement_orders ro
         ON ro.sales_order_line_id = sol.id AND ro.status <> 'cancelled'
      WHERE sos.serial_id = $1
        AND sol.customer_id = $2
        AND sos.status <> 'removed'
        AND COALESCE(sol.quotation_type, 'rental') = 'rental'
        AND COALESCE(sol.rate, 0) > 1
        ${dcClause}
      ORDER BY sos.allocation_id DESC
      LIMIT 1`,
    params
  );
  const rate = parseFloat(r.rows[0]?.rate || 0);
  return rate > 0 ? rate : null;
}

module.exports = {
  resolveSerialRentRate,
  resolveCustomerContractRate,
};
