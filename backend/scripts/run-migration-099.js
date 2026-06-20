require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/099_support_parts_reassign.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(`INSERT INTO schema_migrations (name) VALUES ('099_support_parts_reassign.sql') ON CONFLICT (name) DO NOTHING`);
    await client.query('COMMIT');
    console.log('Migration 099 applied: support part reassignment columns added.');
    process.exit(0);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('099 FAILED (rolled back):', e.message);
    process.exit(1);
  } finally { client.release(); }
}
main().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });
