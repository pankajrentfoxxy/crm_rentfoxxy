require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/107_rbac_data_scope.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (name) VALUES ('107_rbac_data_scope.sql')
       ON CONFLICT (name) DO NOTHING`
    );
    await client.query('COMMIT');
    const sample = await pool.query(`
      SELECT role, section, data_scope
        FROM role_permissions
       WHERE section IN ('tickets', 'floor_pipeline', 'dispatch')
         AND role IN ('dispatch', 'technician', 'floor_manager')
       ORDER BY role, section
       LIMIT 10
    `);
    console.log('Migration 107 applied. Sample role_permissions.data_scope:');
    console.table(sample.rows);
    process.exit(0);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('107 FAILED:', e.message);
    process.exit(1);
  } finally {
    client.release();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
