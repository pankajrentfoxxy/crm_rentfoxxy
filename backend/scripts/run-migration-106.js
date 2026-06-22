require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/106_support_delivery_technician_permissions.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (name) VALUES ('106_support_delivery_technician_permissions.sql')
       ON CONFLICT (name) DO NOTHING`
    );
    await client.query('COMMIT');
    const counts = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM role_permissions WHERE section = 'technician_bucket' AND role IN ('support_tech','support_lead')) AS perms,
        (SELECT COUNT(*)::int FROM delivery_technicians dt
           JOIN users u ON u.user_id = dt.user_id
          WHERE u.role IN ('support_tech','support_lead')) AS linked
    `);
    console.log('Migration 106 applied:', counts.rows[0]);
    process.exit(0);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('106 FAILED:', e.message);
    process.exit(1);
  } finally {
    client.release();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
