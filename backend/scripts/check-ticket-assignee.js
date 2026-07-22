require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
process.env.DB_SSL = process.env.DB_SSL || 'false';
const pool = require('../config/db');

async function main() {
  const r = await pool.query(
    `SELECT t.ticket_id, t.sales_order_number, t.assigned_user_id, u.name, u.email, u.role
       FROM tickets t
       LEFT JOIN users u ON u.user_id = t.assigned_user_id
      WHERE t.ticket_id = $1`,
    [process.argv[2] || 1922]
  );
  console.log(r.rows[0]);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
