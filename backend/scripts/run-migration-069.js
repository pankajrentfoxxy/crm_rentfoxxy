require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sqlPath = path.join(__dirname, '../migrations/069_users_mobile_no.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
  const check = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'users' AND column_name = 'mobile_no'`
  );
  console.log('Migration 069 OK — users.mobile_no present:', check.rows.length === 1);
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
