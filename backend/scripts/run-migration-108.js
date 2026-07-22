require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/108_inward_outward_erp_parity.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (name) VALUES ('108_inward_outward_erp_parity.sql')
       ON CONFLICT (name) DO NOTHING`
    );
    await client.query('COMMIT');
    const cols = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'inward_outward'
        ORDER BY ordinal_position`
    );
    console.log('Migration 108 applied. inward_outward columns:', cols.rows.map((r) => r.column_name).join(', '));
    process.exit(0);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('108 FAILED:', e.message);
    process.exit(1);
  } finally {
    client.release();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
