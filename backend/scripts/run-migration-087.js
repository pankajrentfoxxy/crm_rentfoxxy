require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sqlPath = path.join(__dirname, '../migrations/087_so_line_delivery_address.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);

  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'sales_order_lines'
        AND column_name IN ('delivery_address','is_wfh','delivery_notes')`
  );
  console.log('Migration 087 OK');
  console.log('  sales_order_lines new cols:', cols.rows.map((r) => r.column_name).join(', '));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
