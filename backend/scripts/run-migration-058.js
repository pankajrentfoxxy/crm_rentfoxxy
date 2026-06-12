require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/058_lead_config_columns.sql'), 'utf8');
  console.log('Running migration 058_lead_config_columns.sql...');
  await pool.query(sql);
  console.log('Migration 058 completed.');
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
