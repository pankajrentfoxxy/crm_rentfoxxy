#!/usr/bin/env node
require('dotenv').config();
const pool = require('../config/db');

(async () => {
  const inv = await pool.query(
    `SELECT COUNT(*)::int AS total,
            MIN(invoice_year) AS min_year,
            MAX(invoice_year) AS max_year
       FROM customer_invoices`
  );
  const byYear = await pool.query(
    `SELECT invoice_year, COUNT(*)::int AS n
       FROM customer_invoices GROUP BY invoice_year ORDER BY invoice_year`
  );
  const sample = await pool.query(
    `SELECT invoice_id, invoice_number, invoice_month, invoice_year, status, grand_total
       FROM customer_invoices ORDER BY invoice_id DESC LIMIT 5`
  );
  const readiness = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE current_customer_id IS NOT NULL AND deleted_at IS NULL)::int AS deployed,
       COUNT(*) FILTER (
         WHERE current_customer_id IS NOT NULL AND deleted_at IS NULL
           AND inventory_status IN ('rented','returned')
           AND rent_start_date IS NOT NULL
           AND rent_monthly_rate > 0
       )::int AS billable
     FROM vendor_serial_numbers`
  );
  console.log(JSON.stringify({ invoices: inv.rows[0], byYear: byYear.rows, sample: sample.rows, serials: readiness.rows[0] }, null, 2));
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
