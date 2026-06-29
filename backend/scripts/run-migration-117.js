require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sqlPath = path.join(__dirname, '..', 'migrations', '117_support_ticket_cancellation.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
  console.log('Migration 117_support_ticket_cancellation applied.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
