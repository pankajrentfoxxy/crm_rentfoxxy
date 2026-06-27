require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sql = fs.readFileSync(
    path.join(__dirname, '../migrations/109_remove_test_so_dc_records.sql'),
    'utf8'
  );
  const client = await pool.connect();
  try {
    await client.query(sql);
    const check = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM sales_order_lines WHERE sales_order_number IN ('SO/26-27/0780','SO-000060')) AS so_lines_left,
        (SELECT COUNT(*)::int FROM delivery_challan_lines WHERE dc_number = 'DC/26-27/0779'
            OR sales_order_number IN ('SO/26-27/0780','SO-000060')) AS dc_lines_left
    `);
    console.log('Migration 109 applied:', check.rows[0]);
    process.exit(0);
  } catch (e) {
    console.error('109 FAILED:', e.message);
    process.exit(1);
  } finally {
    client.release();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
