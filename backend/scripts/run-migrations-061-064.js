require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const MIGRATIONS = [
  '061_phase4_sales_pipeline.sql',
  '062_lead_addresses.sql',
  '063_customers_source_lead_id.sql',
  '064_customer_addresses.sql',
];

async function main() {
  for (const file of MIGRATIONS) {
    const sql = fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8');
    console.log(`Running ${file}...`);
    await pool.query(sql);
    console.log(`  OK`);
  }
  console.log('Migrations 061–064 completed.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
