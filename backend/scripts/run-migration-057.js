require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sqlPath = path.join(__dirname, '../migrations/057_phase3_lead_crm.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  console.log('Running migration 057_phase3_lead_crm.sql...');
  await pool.query(sql);
  console.log('Migration 057 completed successfully.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration 057 failed:', err);
  process.exit(1);
});
