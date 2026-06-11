require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sqlPath = path.join(__dirname, '../migrations/068_phase6_support_customer_portal.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
  const check = await pool.query(
    `SELECT COUNT(*)::int AS tables FROM information_schema.tables
     WHERE table_name = 'customer_portal_sessions'`
  );
  console.log('Migration 068 OK — customer_portal_sessions present:', check.rows[0].tables === 1);
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
