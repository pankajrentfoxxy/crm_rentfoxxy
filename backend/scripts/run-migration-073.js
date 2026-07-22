require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sqlPath = path.join(__dirname, '../migrations/073_seed_dummy_data.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);

  const counts = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM users WHERE email LIKE '%@rentfoxxy.com') AS crm_users,
      (SELECT COUNT(*)::int FROM vendors WHERE email IN ('vendor@techrent.com','vendor2@kapoorlaptops.com')) AS vendors,
      (SELECT COUNT(*)::int FROM tickets WHERE ttspl_id LIKE 'TTSPL%') AS floor_tickets,
      (SELECT COUNT(*)::int FROM parts WHERE part_name LIKE 'RAM 8GB%') AS parts
  `);
  const row = counts.rows[0];
  console.log('Migration 073 OK — CRM users:', row.crm_users, 'vendors:', row.vendors, 'floor tickets:', row.floor_tickets, 'parts sample:', row.parts);
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  if (err.detail) console.error('Detail:', err.detail);
  process.exit(1);
});
