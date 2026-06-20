require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/095_qc_stage_dispatch.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(`INSERT INTO schema_migrations (name) VALUES ('095_qc_stage_dispatch.sql') ON CONFLICT (name) DO NOTHING`);
    await client.query('COMMIT');
    const def = await client.query(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='qc_results_qc_stage_check'`);
    console.log('Migration 095 applied. qc_results_qc_stage_check:', def.rows[0]?.d);
    process.exit(0);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('095 FAILED (rolled back):', e.message);
    process.exit(1);
  } finally { client.release(); }
}
main().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });
