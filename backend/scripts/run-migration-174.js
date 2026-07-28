/**
 * Run migration 174 — so_laptop_qc for rental/sale SO laptops tab + config edit.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
process.env.DB_SSL = process.env.DB_SSL || 'false';

const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const MIGRATION_NAME = '174_so_laptop_qc_permission.sql';

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations', MIGRATION_NAME), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
      [MIGRATION_NAME]
    );
    await client.query('COMMIT');
    const check = await pool.query(
      `SELECT u.email, up.section, up.can_view, up.can_edit
         FROM user_permissions up
         JOIN users u ON u.user_id = up.user_id
        WHERE up.section = 'so_laptop_qc'`
    );
    console.log('Migration 174 applied:', check.rows);
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
