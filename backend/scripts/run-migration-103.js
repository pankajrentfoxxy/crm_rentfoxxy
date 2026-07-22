require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/103_dispatch_qc_role.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(`INSERT INTO schema_migrations (name) VALUES ('103_dispatch_qc_role.sql') ON CONFLICT (name) DO NOTHING`);
    await client.query('COMMIT');

    const perms = await client.query(`SELECT COUNT(*)::int AS n FROM role_permissions WHERE role = 'dispatch_qc'`);
    console.log(`Migration 103 applied: dispatch_qc role enabled (${perms.rows[0].n} permission rows).`);
    process.exit(0);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('103 FAILED (rolled back):', e.message);
    process.exit(1);
  } finally { client.release(); }
}
main().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });
