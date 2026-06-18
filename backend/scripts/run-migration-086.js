require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

async function main() {
  const sqlPath = path.join(__dirname, '../migrations/086_delivery_flow_complete.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  await pool.query(sql);

  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'delivery_challan_lines'
        AND column_name IN ('otp_code','pod_photo_url','esign_url','reached_at','tech_latitude','porter_tracking_id')`
  );
  const sosCols = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'sales_order_serials'
        AND column_name IN ('delivery_address','is_wfh','delivery_notes')`
  );
  const sec = await pool.query(
    `SELECT COUNT(*)::int AS n FROM permission_sections WHERE section = 'technician_bucket'`
  );

  console.log('Migration 086 OK');
  console.log('  delivery_challan_lines new cols:', cols.rows.map((r) => r.column_name).join(', '));
  console.log('  sales_order_serials new cols  :', sosCols.rows.map((r) => r.column_name).join(', '));
  console.log('  technician_bucket section      :', sec.rows[0].n === 1 ? 'exists' : 'MISSING');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
