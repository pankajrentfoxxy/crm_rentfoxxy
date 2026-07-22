require('dotenv').config();
const pool = require('../config/db');

async function main() {
  const items = await pool.query(
    `SELECT id, ticket_id, pickup_type, pickup_method, status,
            assigned_to, pickup_assigned_to, return_dc_number,
            customer_otp_code, customer_otp_verified_at, warehouse_received_at,
            ttspl_id, serial_number
       FROM support_ticket_items
      WHERE item_type = 'pickup'
      ORDER BY id DESC LIMIT 6`
  );
  console.log('PICKUP ITEMS:');
  console.table(items.rows);

  const dcl = await pool.query(
    `SELECT dc_number, movement_type, support_ticket_id, sales_order_number,
            original_dc_number, dispatch_mode, status, delivery_otp_code,
            delivery_person_id, courier_name
       FROM delivery_challan_lines
      WHERE movement_type='return'
      ORDER BY id DESC LIMIT 8`
  );
  console.log('\nRETURN DC LINES:');
  console.table(dcl.rows);

  process.exit(0);
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
