require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const DELIVERED = `(SELECT COUNT(*)::int FROM sales_order_serials sos
  WHERE sos.sales_order_number = s.sales_order_number
    AND sos.status = 'dispatched' AND sos.dc_number IS NOT NULL
    AND EXISTS (SELECT 1 FROM delivery_challan_lines dcl WHERE dcl.dc_number = sos.dc_number AND dcl.status = 'delivered'))`;

const DISPATCHED = `(SELECT COUNT(*)::int FROM sales_order_serials sos
  WHERE sos.sales_order_number = s.sales_order_number
    AND sos.status = 'dispatched' AND sos.dc_number IS NOT NULL
    AND EXISTS (SELECT 1 FROM delivery_challan_lines dcl WHERE dcl.dc_number = sos.dc_number AND COALESCE(dcl.status,'pending') NOT IN ('delivered','rejected')))`;

async function main() {
  const rentalWhere = `(LOWER(COALESCE(quotation_type, 'rental')) = 'rental'
    OR (LOWER(COALESCE(quotation_type, '')) = 'demo'
      AND LOWER(COALESCE(entity_code, 'rentfoxxy')) = 'rentfoxxy'))`;

  for (const label of ['rental', 'all']) {
    const scopeJoin = label === 'rental'
      ? `FROM (SELECT DISTINCT sales_order_number FROM sales_order_lines WHERE ${rentalWhere}) s`
      : 'FROM (SELECT DISTINCT sales_order_number FROM sales_order_lines) s';

    const agg = await pool.query(`
    WITH so AS (
      SELECT sales_order_number,
        (SELECT COALESCE(SUM(COALESCE(main_qty, quantity, 0)), 0)::int
           FROM sales_order_lines sol WHERE sol.sales_order_number = s.sales_order_number) AS laptop_qty,
        (SELECT COUNT(*)::int FROM sales_order_serials sos
           WHERE sos.sales_order_number = s.sales_order_number AND sos.status = 'attached') AS attached,
        ${DELIVERED} AS delivered,
        ${DISPATCHED} AS dispatched
      ${scopeJoin}
    ),
    calc AS (
      SELECT *,
        GREATEST(0, laptop_qty - attached - delivered - dispatched) AS pending_per_order,
        (attached + delivered + dispatched) AS accounted
      FROM so
    )
    SELECT
      SUM(laptop_qty)::int AS total_laptops,
      SUM(attached)::int AS attached,
      SUM(delivered)::int AS delivered,
      SUM(dispatched)::int AS dispatched,
      SUM(pending_per_order)::int AS pending_old_way_213,
      GREATEST(0, SUM(laptop_qty) - SUM(attached) - SUM(delivered) - SUM(dispatched))::int AS pending_correct_205,
      SUM(GREATEST(0, accounted - laptop_qty))::int AS hidden_excess_serials
    FROM calc
  `);

    console.log(`\n=== ${label.toUpperCase()} scope ===`);
    console.log(agg.rows[0]);
    const r = agg.rows[0];
    console.log(`Check: delivered+attached+dispatched+pending_correct = ${
      r.delivered + r.attached + r.dispatched + r.pending_correct_205} (total ${r.total_laptops})`);
    console.log(`Old sum per order pending (${r.pending_old_way_213}) vs correct (${r.pending_correct_205}) gap = ${
      r.pending_old_way_213 - r.pending_correct_205}`);
  }

  const excess = await pool.query(`
    WITH so AS (
      SELECT sales_order_number,
        (SELECT COALESCE(SUM(COALESCE(main_qty, quantity, 0)), 0)::int
           FROM sales_order_lines sol WHERE sol.sales_order_number = s.sales_order_number) AS laptop_qty,
        (SELECT COUNT(*)::int FROM sales_order_serials sos
           WHERE sos.sales_order_number = s.sales_order_number AND sos.status = 'attached') AS attached,
        ${DELIVERED} AS delivered,
        ${DISPATCHED} AS dispatched
      FROM (SELECT DISTINCT sales_order_number FROM sales_order_lines WHERE ${rentalWhere}) s
    )
    SELECT sales_order_number, laptop_qty, attached, delivered, dispatched,
      (attached + delivered + dispatched) AS serials_tracked,
      GREATEST(0, (attached + delivered + dispatched) - laptop_qty) AS excess_serials,
      GREATEST(0, laptop_qty - attached - delivered - dispatched) AS pending_per_order
    FROM so
    WHERE (attached + delivered + dispatched) > laptop_qty OR laptop_qty < 0
    ORDER BY excess_serials DESC, laptop_qty ASC
    LIMIT 20
  `);

  console.log('\n=== Rental orders with bad qty / extra serials ===');
  console.table(excess.rows);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
