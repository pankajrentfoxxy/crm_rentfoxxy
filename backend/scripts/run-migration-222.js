/**
 * Run numbered-222 migrations that landed from both branches:
 *   - 222_vrdc_gate_flow.sql (staging VRDC guard-gate)
 *   - 222_invoice_security_deposit.sql (incoming invoice deposit columns)
 * Usage: node scripts/run-migration-222.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
process.env.DB_SSL = process.env.DB_SSL || 'false';

const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const MIGRATIONS = [
  '222_vrdc_gate_flow.sql',
  '222_invoice_security_deposit.sql',
];

async function applyOne(client, name) {
  const sqlPath = path.join(__dirname, '../migrations', name);
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (name) VALUES ($1)
       ON CONFLICT (name) DO NOTHING`,
      [name]
    );
    await client.query('COMMIT');
    console.log('Applied:', name);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
}

async function main() {
  const client = await pool.connect();
  try {
    for (const name of MIGRATIONS) {
      await applyOne(client, name);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
