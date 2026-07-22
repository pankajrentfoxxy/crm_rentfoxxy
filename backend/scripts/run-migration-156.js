/**
 * Run migration 156 — inventory_tag_access (all/sales/rental) on role_permissions + user_permissions.
 * Usage (from backend/): node scripts/run-migration-156.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
process.env.DB_SSL = process.env.DB_SSL || 'false';

const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const MIGRATION_NAME = '156_inventory_tag_access_permission.sql';

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

    const check = await pool.query(`
      SELECT
        EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_name = 'role_permissions' AND column_name = 'inventory_tag_access'
        ) AS role_col,
        EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_name = 'user_permissions' AND column_name = 'inventory_tag_access'
        ) AS user_col
    `);

    console.log(`Migration 156 applied: ${sqlPath}`);
    console.log('Verification:', check.rows[0]);
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
