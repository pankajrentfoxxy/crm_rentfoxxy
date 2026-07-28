/**
 * Run migration 175 — floor_ticket_config_edit permission for floor ticket config edits.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
process.env.DB_SSL = process.env.DB_SSL || 'false';

const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const MIGRATION_NAME = '175_floor_ticket_config_edit_permission.sql';

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
      `SELECT role, can_view, can_edit
         FROM role_permissions
        WHERE section = 'floor_ticket_config_edit'
        ORDER BY role`
    );
    console.log('Migration 175 applied:', check.rows);
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
