/**
 * Run migration 200 — Vendor Repair DC RBAC section.
 * Usage: node scripts/run-migration-200.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
process.env.DB_SSL = process.env.DB_SSL || 'false';

const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const MIGRATION_NAME = '200_vendor_repair_dc_permission.sql';

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
    console.log('Migration 200 applied:', sqlPath);

    const { rows } = await pool.query(
      `SELECT section, description, sort_order
         FROM permission_sections
        WHERE section = 'vendor_repair_dc'`
    );
    console.log(rows);
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
