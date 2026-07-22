require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/093_return_dc_flow.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(`INSERT INTO schema_migrations (name) VALUES ('093_return_dc_flow.sql') ON CONFLICT (name) DO NOTHING`);
    await client.query('COMMIT');
    console.log('Migration 093 applied: return DC flow columns added.');
    process.exit(0);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('093 FAILED (rolled back):', e.message);
    process.exit(1);
  } finally { client.release(); }
}
main().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });
