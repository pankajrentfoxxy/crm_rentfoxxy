/**
 * Apply migration 147 — customers.customer_type
 * Usage: node backend/scripts/run-migration-147.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sql = fs.readFileSync(
    path.join(__dirname, '../migrations/147_customer_type.sql'),
    'utf8'
  );
  await pool.query(sql);
  await pool.query(
    `INSERT INTO schema_migrations (name) VALUES ('147_customer_type.sql')
     ON CONFLICT (name) DO NOTHING`
  );
  const check = await pool.query(
    `SELECT column_name, column_default
       FROM information_schema.columns
      WHERE table_name = 'customers' AND column_name = 'customer_type'`
  );
  console.log('Migration 147 applied. customer_type:', check.rows[0] || null);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
