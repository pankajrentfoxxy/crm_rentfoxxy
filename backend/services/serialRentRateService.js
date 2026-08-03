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
  const bySerial = await client.query(
    `SELECT sol.rate
       FROM sales_order_serials sos
       JOIN sales_order_lines sol ON sol.id = sos.line_id
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

module.exports = {
  resolveSerialRentRate,
};
