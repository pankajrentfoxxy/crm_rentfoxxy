require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/096_support_v3_columns.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(`INSERT INTO schema_migrations (name) VALUES ('096_support_v3_columns.sql') ON CONFLICT (name) DO NOTHING`);
    await client.query('COMMIT');
    console.log('Migration 096 applied: support_ticket_items v3 columns ensured.');
    process.exit(0);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('096 FAILED (rolled back):', e.message);
    process.exit(1);
  } finally { client.release(); }
}
main().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });
