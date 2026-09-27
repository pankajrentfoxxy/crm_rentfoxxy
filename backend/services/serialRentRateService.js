const pool = require('../config/db');

function isSaleLine(quotationType) {
  return ['sale', 'sales'].includes(String(quotationType || '').toLowerCase());
}

/**
 * Monthly rent for a serial from its sales-order allocation (authoritative for DC billing).
 * A sale line's rate is a price, not rent: TTSPL3059 went out on a sale order and
 * was left 'rented' at the Rs 20,000 sale price. Sale lines give no rent.
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
  const bySerial = await client.query(
    `SELECT sol.rate, sol.quotation_type
       FROM sales_order_serials sos
       JOIN sales_order_lines sol ON sol.id = sos.line_id
      WHERE sos.serial_id = $1
        AND sos.status <> 'removed'
        ${dcClause}
      ORDER BY sos.allocation_id DESC
      LIMIT 1`,
    params
  );
  if (bySerial.rows.length && isSaleLine(bySerial.rows[0].quotation_type)) return null;
  const serialRate = parseFloat(bySerial.rows[0]?.rate || 0);
  if (serialRate > 0) return serialRate;

  if (!dcNumber) return null;
  const byDc = await client.query(
    `SELECT sol.rate, sol.quotation_type
       FROM delivery_challan_lines dcl
       JOIN sales_order_lines sol ON sol.sales_order_number = dcl.sales_order_number
      WHERE dcl.dc_number = $1
      ORDER BY (sol.brand = dcl.brand) DESC NULLS LAST, sol.id ASC
      LIMIT 1`,
    [dcNumber]
  );
  if (byDc.rows.length && isSaleLine(byDc.rows[0].quotation_type)) return null;
  const dcRate = parseFloat(byDc.rows[0]?.rate || 0);
  return dcRate > 0 ? dcRate : null;
}

/**
 * The monthly rent THIS customer agreed for this laptop: the rate on the
 * customer's own rental sales-order line the unit was allocated to (the DC's
 * SO when dcNumber is given, else the latest). A laptop's
 * vendor_serial_numbers.rent_monthly_rate is one field that outlives each
 * rental, so on a re-rented unit it can still hold the previous customer's
 * rate; the SO line cannot. Rs 1 placeholders (demo, draft SOs) don't count.
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
    `SELECT sol.rate
       FROM sales_order_serials sos
       JOIN sales_order_lines sol ON sol.id = sos.line_id
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
