/**
 * Run migration 173 — replacement SO laptop attach & QC permission.
 * Usage (from backend/): node scripts/run-migration-173.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
process.env.DB_SSL = process.env.DB_SSL || 'false';

const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const MIGRATION_NAME = '173_replacement_so_laptop_qc_permission.sql';

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
    const check = await pool.query(
      `SELECT role, section, can_view, can_edit FROM role_permissions
        WHERE role = 'support_lead'
          AND section IN ('sales_orders_replacement', 'replacement_so_laptop_qc')
        ORDER BY section`
    );
    console.log(`Migration 173 applied. support_lead grants:`, check.rows);
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
