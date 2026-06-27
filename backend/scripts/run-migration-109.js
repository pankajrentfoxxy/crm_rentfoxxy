require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const {
  peekFinancialYearNumber,
} = require('../services/salesManagementService');

async function main() {
  const sql = fs.readFileSync(
    path.join(__dirname, '../migrations/109_remove_test_so_dc_records.sql'),
    'utf8'
  );
  const client = await pool.connect();
  try {
    await client.query(sql);
    const check = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM sales_order_lines WHERE sales_order_number IN ('SO/26-27/0780','SO-000060')) AS so_lines_left,
        (SELECT COUNT(*)::int FROM delivery_challan_lines WHERE dc_number = 'DC/26-27/0779'
            OR sales_order_number IN ('SO/26-27/0780','SO-000060')) AS dc_lines_left,
        (SELECT COUNT(*)::int FROM sales_order_lines WHERE sales_order_number = 'SO/26-27/0779') AS so_0779_kept
    `);
    const nextSo = await peekFinancialYearNumber('sales_order');
    const nextDc = await peekFinancialYearNumber('delivery_challan');
    const rdc = await client.query(`
      SELECT last_value FROM sm_document_sequences WHERE doc_type = 'return_dc'
    `);
    const maxRdc = Number(rdc.rows[0]?.last_value || 0);
    const nextRdc = `RDC${String(maxRdc + 1).padStart(6, '0')}`;

    console.log('Migration 109 applied:', check.rows[0]);
    console.log('Next numbers (peek, not reserved):');
    console.log('  Sales Order:', nextSo);
    console.log('  Delivery Challan:', nextDc);
    console.log('  Return DC:', nextRdc);
    process.exit(0);
  } catch (e) {
    console.error('109 FAILED:', e.message);
    process.exit(1);
  } finally {
    client.release();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
