/**
 * Run migration 157 — granular Ready Stock access (rental_only, rental_both, sale_only, sale_both).
 * Usage (from backend/): node scripts/run-migration-157.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
process.env.DB_SSL = process.env.DB_SSL || 'false';

const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const MIGRATION_NAME = '157_inventory_tag_access_granular.sql';

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
      SELECT inventory_tag_access, COUNT(*)::int AS c
        FROM role_permissions
       WHERE section IN ('inventory_management', 'inventory')
       GROUP BY inventory_tag_access
       ORDER BY inventory_tag_access
    `);

    console.log(`Migration 157 applied: ${sqlPath}`);
    console.log('inventory_tag_access on inventory roles:', check.rows);
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
