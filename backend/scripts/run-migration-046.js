const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const MIGRATION = '046_qc_check_parity.sql';

async function main() {
  const sqlPath = path.join(__dirname, '..', 'migrations', MIGRATION);
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
  await pool.query(
    'INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
    [MIGRATION]
  );
  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'allocation_logs' ORDER BY ordinal_position`
  );
  console.log('Migration applied:', MIGRATION);
  console.log('allocation_logs columns:', cols.rows.map((r) => r.column_name).join(', '));
  await pool.end();
}

main().catch(async (e) => {
  console.error('Migration failed:', e.message);
  await pool.end();
  process.exit(1);
});
