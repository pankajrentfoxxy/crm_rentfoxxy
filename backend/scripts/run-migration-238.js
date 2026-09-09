/**
 * Run migration 238 — QC move-to-ticket permission.
 * Usage: node scripts/run-migration-238.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const MIGRATION_NAME = '238_qc_move_to_ticket_permission.sql';

async function main() {
  const sqlPath = path.join(__dirname, '../migrations', MIGRATION_NAME);
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (name) VALUES ($1)
       ON CONFLICT (name) DO NOTHING`,
      [MIGRATION_NAME]
    );
    await client.query('COMMIT');
    console.log('Migration 238 applied:', sqlPath);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
