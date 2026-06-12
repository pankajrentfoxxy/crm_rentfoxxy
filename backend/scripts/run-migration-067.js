require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sqlPath = path.join(__dirname, '../migrations/067_phase5_billing_engine.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
  const check = await pool.query(
    `SELECT COUNT(*)::int AS tables FROM information_schema.tables
     WHERE table_name IN ('customer_invoices','einvoice_records','eway_bill_records')`
  );
  console.log('Migration 067 OK — billing tables present:', check.rows[0].tables);
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
