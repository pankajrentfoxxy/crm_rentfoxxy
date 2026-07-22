require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sqlPath = path.join(__dirname, '../migrations/078_clean_and_reseed.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (name) VALUES ('078_clean_and_reseed.sql')
       ON CONFLICT (name) DO NOTHING`
    );
    await client.query('COMMIT');
    console.log('Migration 078 applied: DB wiped + reseeded.');

    const counts = await client.query(`
      SELECT 'users' t, COUNT(*) c FROM users
      UNION ALL SELECT 'vendors', COUNT(*) FROM vendors
      UNION ALL SELECT 'customers', COUNT(*) FROM customers
      UNION ALL SELECT 'leads', COUNT(*) FROM leads
      UNION ALL SELECT 'vendor_purchase_orders', COUNT(*) FROM vendor_purchase_orders
      UNION ALL SELECT 'vendor_serial_numbers', COUNT(*) FROM vendor_serial_numbers
      UNION ALL SELECT 'tickets', COUNT(*) FROM tickets
      UNION ALL SELECT 'sales_quotations', COUNT(*) FROM sales_quotations
      UNION ALL SELECT 'sales_order_lines', COUNT(*) FROM sales_order_lines
      UNION ALL SELECT 'sales_order_serials', COUNT(*) FROM sales_order_serials
      UNION ALL SELECT 'delivery_challan_lines', COUNT(*) FROM delivery_challan_lines
      UNION ALL SELECT 'demo_agreements', COUNT(*) FROM demo_agreements
      UNION ALL SELECT 'customer_invoices', COUNT(*) FROM customer_invoices
      UNION ALL SELECT 'support_tickets', COUNT(*) FROM support_tickets
      ORDER BY t`);
    console.table(counts.rows.map((r) => ({ table: r.t, rows: Number(r.c) })));
    process.exit(0);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration 078 FAILED (rolled back):', err.message);
    if (err.detail) console.error('  detail:', err.detail);
    if (err.where) console.error('  where:', err.where);
    process.exit(1);
  } finally {
    client.release();
  }
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
