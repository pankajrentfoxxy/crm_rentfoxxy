/**
 * Apply migration 169 — sales_orders_replacement permission for support_lead
 * Usage: node backend/scripts/run-migration-169.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sql = fs.readFileSync(
    path.join(__dirname, '../migrations/169_sales_orders_replacement_permission.sql'),
    'utf8'
  );
  await pool.query(sql);
  await pool.query(
    `INSERT INTO schema_migrations (name) VALUES ('169_sales_orders_replacement_permission.sql')
     ON CONFLICT (name) DO NOTHING`
  );
  const check = await pool.query(
    `SELECT can_view, can_edit, data_scope FROM role_permissions
      WHERE role = 'support_lead' AND section = 'sales_orders_replacement'`
  );
  console.log('Migration 169 applied. support_lead sales_orders_replacement:', check.rows[0]);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
