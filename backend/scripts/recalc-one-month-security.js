#!/usr/bin/env node
/**
 * Recalculate security_amount for all SOs with security_type = one_month_rental
 * and sync pro-rated security on linked outbound DCs.
 *
 * Usage: node backend/scripts/recalc-one-month-security.js [SO/26-27/0987]
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const pool = require('../config/db');
const {
  recalcSoSecurityIfOneMonthRental,
  syncDcSecurityForSo,
} = require('../services/salesManagementService');

async function main() {
  const targetSo = process.argv[2] || null;
  const client = await pool.connect();
  try {
    let soNumbers;
    if (targetSo) {
      soNumbers = [targetSo];
    } else {
      const r = await client.query(
        `SELECT DISTINCT sales_order_number
           FROM sales_order_lines
          WHERE LOWER(COALESCE(security_type, '')) = 'one_month_rental'
          ORDER BY sales_order_number`
      );
      soNumbers = r.rows.map((row) => row.sales_order_number);
    }

    console.log(`Recalculating security for ${soNumbers.length} sales order(s)...`);
    for (const soNumber of soNumbers) {
      await client.query('BEGIN');
      const newSecurity = await recalcSoSecurityIfOneMonthRental(client, soNumber);
      if (newSecurity != null) {
        await syncDcSecurityForSo(client, soNumber);
        await client.query('COMMIT');
        console.log(`${soNumber}: security = ₹${newSecurity.toFixed(2)}`);
      } else {
        await client.query('ROLLBACK');
        console.log(`${soNumber}: skipped (not one_month_rental or no lines)`);
      }
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
