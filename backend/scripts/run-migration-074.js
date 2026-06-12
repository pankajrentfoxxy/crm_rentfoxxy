require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sqlPath = path.join(__dirname, '../migrations/074_foundation_inventory_entity_demo.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);

  const checks = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS n FROM companies`),
    pool.query(`SELECT COUNT(*)::int AS n FROM information_schema.columns
                 WHERE table_name='vendor_serial_numbers' AND column_name='rent_start_date'`),
    pool.query(`SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_name='demo_agreements'`),
    pool.query(`SELECT COUNT(*)::int AS n FROM sm_document_sequences WHERE doc_type LIKE '%gorefurbo'`),
  ]);
  console.log('Migration 074 applied:');
  console.log('  companies rows:', checks[0].rows[0].n);
  console.log('  vsn.rent_start_date present:', checks[1].rows[0].n === 1);
  console.log('  demo_agreements table:', checks[2].rows[0].n === 1);
  console.log('  gorefurbo sequences:', checks[3].rows[0].n);
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration 074 failed:', err.message);
  process.exit(1);
});
