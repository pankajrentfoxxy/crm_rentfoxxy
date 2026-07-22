require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
process.env.DB_SSL = process.env.DB_SSL || 'false';
const pool = require('../config/db');

async function main() {
  const r = await pool.query(
    `SELECT dw.*, u.name, u.email, u.role
       FROM dispatch_workflow dw
       LEFT JOIN users u ON u.user_id = dw.assigned_user_id
      WHERE dw.sales_order_number = 'SO/26-27/0963'`
  );
  console.log(JSON.stringify(r.rows[0], null, 2));
  const perms = await pool.query(
    `SELECT role, section, can_view, can_edit FROM role_permissions
      WHERE role = 'dispatch' AND section IN ('dispatch_pending_orders', 'dispatch_workflow')`
  );
  console.log('dispatch perms', perms.rows);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
