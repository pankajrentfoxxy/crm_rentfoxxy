require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');
const { peekFinancialYearNumber } = require('../services/salesManagementService');

async function main() {
  const sql = fs.readFileSync(
    path.join(__dirname, '../migrations/111_renumber_so_fill_0780_gap.sql'),
    'utf8'
  );
  const client = await pool.connect();
  try {
    await client.query(sql);
    const check = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM sales_order_lines WHERE sales_order_number = 'SO/26-27/0780') AS so_0780,
        (SELECT COUNT(*)::int FROM sales_order_lines WHERE sales_order_number = 'SO/26-27/0781') AS so_0781,
        (SELECT COUNT(*)::int FROM sales_order_lines WHERE sales_order_number = 'SO/26-27/0782') AS so_0782_old,
        (SELECT last_value FROM sm_document_sequences WHERE doc_type = 'so_rentfoxxy') AS so_seq
    `);
    const nextSo = await peekFinancialYearNumber('sales_order');
    console.log('Migration 111 applied:', check.rows[0]);
    console.log('Next Sales Order (peek):', nextSo);
    process.exit(0);
  } catch (e) {
    console.error('111 FAILED:', e.message);
    process.exit(1);
  } finally {
    client.release();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
