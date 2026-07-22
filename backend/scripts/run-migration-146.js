/**
 * Apply migration 146 — dispatch_qc_capture_tokens
 * Usage: node backend/scripts/run-migration-146.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sql = fs.readFileSync(
    path.join(__dirname, '../migrations/146_dispatch_qc_capture_tokens.sql'),
    'utf8'
  );
  await pool.query(sql);
  await pool.query(
    `INSERT INTO schema_migrations (name) VALUES ('146_dispatch_qc_capture_tokens.sql')
     ON CONFLICT (name) DO NOTHING`
  );
  const check = await pool.query(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables
      WHERE table_name = 'dispatch_qc_capture_tokens'`
  );
  console.log('Migration 146 applied. dispatch_qc_capture_tokens exists:', check.rows[0]?.n === 1);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
