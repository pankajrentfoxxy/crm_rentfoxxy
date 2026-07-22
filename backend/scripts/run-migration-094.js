require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/094_dispatch_qc_and_cancel_status.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(`INSERT INTO schema_migrations (name) VALUES ('094_dispatch_qc_and_cancel_status.sql') ON CONFLICT (name) DO NOTHING`);
    await client.query('COMMIT');
    const stage = await client.query(`SELECT stage_id, stage_name FROM stages WHERE stage_name='Dispatch QC'`);
    const def = await client.query(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='tickets_status_check'`);
    console.log('Migration 094 applied.');
    console.log('  Dispatch QC stage:', stage.rows[0] || 'MISSING');
    console.log('  tickets_status_check:', def.rows[0]?.d);
    process.exit(0);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('094 FAILED (rolled back):', e.message);
    process.exit(1);
  } finally { client.release(); }
}
main().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });
