require('dotenv').config();
const pool = require('../config/db');

async function main() {
  const r = await pool.query(
    `SELECT id, ticket_id, pickup_type, pickup_method, status,
            assigned_to, pickup_assigned_to, return_dc_number,
            (customer_otp_code IS NOT NULL) AS has_otp,
            customer_otp_verified_at, warehouse_received_at
       FROM support_ticket_items
      WHERE item_type = 'pickup'
      ORDER BY id DESC`
  );
  console.table(r.rows);
  process.exit(0);
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
