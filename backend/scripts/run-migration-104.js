require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/104_asset_configuration.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (name) VALUES ('104_asset_configuration.sql')
       ON CONFLICT (name) DO NOTHING`
    );
    await client.query('COMMIT');
    console.log('Migration 104 applied: asset configuration tables.');
    process.exit(0);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('104 FAILED:', e.message);
    process.exit(1);
  } finally {
    client.release();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
