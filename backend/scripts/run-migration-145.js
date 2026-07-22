require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
process.env.DB_SSL = process.env.DB_SSL || 'false';
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sql = fs.readFileSync(
    path.join(__dirname, '../migrations/145_pending_inventory_permission.sql'),
    'utf8'
  );
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (name) VALUES ('145_pending_inventory_permission.sql')
       ON CONFLICT (name) DO NOTHING`
    );
    await client.query('COMMIT');
    const check = await pool.query(
      `SELECT role, can_view, can_edit
         FROM role_permissions
        WHERE section = 'pending_inventory'
        ORDER BY role`
    );
    console.log('Migration 145 applied. pending_inventory grants:', check.rows);
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
