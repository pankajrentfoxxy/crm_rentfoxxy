require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sqlPath = path.join(__dirname, '../migrations/072_phase10_user_role_management.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);

  const roles = await pool.query(
    `SELECT COUNT(*)::int AS n FROM roles
     WHERE name = ANY($1::text[])`,
    [['super_admin', 'admin', 'manager', 'sales', 'floor_manager', 'team_member', 'team_lead',
      'qc', 'procurement', 'warehouse', 'dispatch', 'accounts', 'support_lead', 'support_tech']]
  );
  const sections = await pool.query('SELECT COUNT(*)::int AS n FROM permission_sections');
  console.log('Migration 072 OK — roles:', roles.rows[0].n, 'permission_sections:', sections.rows[0].n);
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
