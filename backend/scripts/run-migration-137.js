const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/137_dispatch_qc_permission.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (name) VALUES ('137_dispatch_qc_permission.sql') ON CONFLICT (name) DO NOTHING`
    );
    await client.query('COMMIT');
    const perms = await client.query(
      `SELECT COUNT(*)::int AS n FROM role_permissions WHERE section = 'dispatch_qc'`
    );
    console.log(`Migration 137 applied: dispatch_qc permission section (${perms.rows[0].n} role rows).`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
