require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sqlPath = path.join(__dirname, '../migrations/070_phase7_reporting.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
  const check = await pool.query(
    `SELECT section FROM permission_sections
     WHERE section IN ('analytics_dashboard', 'reports_export')
     ORDER BY section`
  );
  console.log('Migration 070 OK — sections:', check.rows.map((r) => r.section).join(', '));
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
