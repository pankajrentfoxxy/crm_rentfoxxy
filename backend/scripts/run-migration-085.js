require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sqlPath = path.join(__dirname, '../migrations/085_ticket_status_return_vendor.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
  const check = await pool.query(
    `SELECT pg_get_constraintdef(oid) AS def
       FROM pg_constraint
      WHERE conname = 'tickets_status_check'`
  );
  const def = check.rows[0]?.def || '';
  console.log('Migration 085 OK — tickets_status_check now:', def);
  console.log('Includes qc_failed_return_vendor:', def.includes('qc_failed_return_vendor') ? 'yes' : 'NO');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
