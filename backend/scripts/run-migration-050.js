const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const MIGRATION = '050_technicians_bucket_list.sql';

async function main() {
  const sqlPath = path.join(__dirname, '..', 'migrations', MIGRATION);
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);
  await pool.query(
    'INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
    [MIGRATION]
  );
  console.log('Migration applied:', MIGRATION);
  await pool.end();
}

main().catch(async (e) => {
  console.error('Migration failed:', e.message);
  await pool.end();
  process.exit(1);
});
