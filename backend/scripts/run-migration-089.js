require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sqlPath = path.join(__dirname, '../migrations/089_grn_access_numbers.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);

  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('grn_access_numbers','grn_access_attempts')`
  );
  const seq = await pool.query(
    `SELECT 1 FROM pg_class WHERE relkind = 'S' AND relname = 'grn_access_number_seq'`
  );
  console.log('Migration 089 OK');
  console.log('  tables  :', tables.rows.map((r) => r.table_name).join(', '));
  console.log('  sequence:', seq.rows.length ? 'grn_access_number_seq' : 'NO');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
