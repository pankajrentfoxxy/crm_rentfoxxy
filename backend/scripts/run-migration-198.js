/**
 * Run migration 198 — Return DC e-sign signer name columns + backfill.
 * Usage: node scripts/run-migration-198.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
process.env.DB_SSL = process.env.DB_SSL || 'false';

const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const MIGRATION_NAME = '198_return_dc_esign_signer_names.sql';

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
    console.log('Migration 198 applied:', sqlPath);

    const { regenerateReturnDcPdfByRdc } = require('../services/returnDcPdfService');
    const rdc = process.argv[2] || 'RDC001850';
    const pdf = await regenerateReturnDcPdfByRdc(pool, rdc);
    console.log('Regenerated PDF for', rdc, '->', pdf);
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
