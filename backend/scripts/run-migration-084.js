require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sqlPath = path.join(__dirname, '../migrations/084_grn_serial_capture.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
  const check = await pool.query(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_name = 'grn_serial_capture_tokens'`
  );
  console.log('Migration 084 OK — grn_serial_capture_tokens table:', check.rows[0].n === 1 ? 'exists' : 'missing');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
