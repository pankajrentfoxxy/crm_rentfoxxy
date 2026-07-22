#!/usr/bin/env node
/**
 * Backfill normalized line tables from existing JSONB snapshots on invoices/bills.
 */
require('dotenv').config();
const pool = require('../config/db');
const {
  insertCustomerInvoiceLines,
  insertVendorBillLines,
} = require('../services/billingLineItemsService');

function parseLines(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const invRes = await client.query(
      `SELECT ci.invoice_id, ci.line_items
       FROM customer_invoices ci
       WHERE NOT EXISTS (
         SELECT 1 FROM customer_invoice_lines cil WHERE cil.invoice_id = ci.invoice_id
       )`
    );
    let invCount = 0;
    for (const row of invRes.rows) {
      const lines = parseLines(row.line_items);
      if (!lines.length) continue;
      await insertCustomerInvoiceLines(client, row.invoice_id, lines);
      invCount += 1;
    }

    const billRes = await client.query(
      `SELECT vb.bill_id, vb.line_items
       FROM vendor_monthly_bills vb
       WHERE NOT EXISTS (
         SELECT 1 FROM vendor_bill_lines vbl WHERE vbl.bill_id = vb.bill_id
       )`
    );
    let billCount = 0;
    for (const row of billRes.rows) {
      const lines = parseLines(row.line_items);
      if (!lines.length) continue;
      await insertVendorBillLines(client, row.bill_id, lines);
      billCount += 1;
    }

    await client.query('COMMIT');
    console.log(`Backfill complete: ${invCount} invoices, ${billCount} vendor bills.`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
