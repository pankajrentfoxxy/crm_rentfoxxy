'use strict';

require('dotenv').config();
const pool = require('../config/db');
const { buildCustomerInvoiceLines } = require('../services/billingSchedulerService');
const { applyRentHolds, pullApprovedExtraLines } = require('../services/supportBillingHooks');

function parseMonth(raw) {
  const m = String(raw || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) {
    console.error('Usage: node scripts/reconcile-billing-hooks.js --month 2026-07');
    process.exit(1);
  }
  return { year: Number(m[1]), month: Number(m[2]) };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function main() {
  const { year, month } = parseMonth(arg('--month'));
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0);
  const customers = await pool.query(
    `SELECT DISTINCT current_customer_id AS customer_id
       FROM vendor_serial_numbers
      WHERE current_customer_id IS NOT NULL
        AND deleted_at IS NULL
        AND inventory_status IN ('rented', 'returned', 'in_transit')
        AND rent_start_date IS NOT NULL
     UNION
     SELECT DISTINCT customer_id
       FROM customer_invoice_extra_lines
      WHERE status = 'APPROVED' AND billed_in_invoice_id IS NULL AND customer_id IS NOT NULL`
  );

  console.log(`Billing hook reconcile ${year}-${String(month).padStart(2, '0')}`);
  console.log('customer_id\trent_before\trent_after\tdays_waived\textra_lines\tdelta\tnote');

  let unexplained = 0;
  const client = await pool.connect();
  try {
    for (const row of customers.rows) {
      await client.query('BEGIN');
      try {
        const built = await buildCustomerInvoiceLines(client, {
          customerId: row.customer_id, month, year, monthStart, monthEnd,
        });
        const held = await applyRentHolds(client, built.lineItems, monthStart, monthEnd);
        const extras = await pullApprovedExtraLines(client, row.customer_id);
        const extraSum = extras.reduce((s, e) => s + Number(e.amount || 0), 0);
        const rentBefore = Number(built.subtotal.toFixed(2));
        const rentAfter = Number(held.subtotal.toFixed(2));
        const expectedDelta = Number((extraSum - held.amountWaived).toFixed(2));
        const actualDelta = Number((rentAfter + extraSum - rentBefore).toFixed(2));
        const ok = Math.abs(actualDelta - expectedDelta) < 0.02;
        if (!ok) unexplained += 1;
        console.log([
          row.customer_id,
          rentBefore.toFixed(2),
          rentAfter.toFixed(2),
          held.daysWaived,
          extras.length,
          actualDelta.toFixed(2),
          ok ? 'ok' : 'UNEXPLAINED',
        ].join('\t'));
      } finally {
        await client.query('ROLLBACK');
      }
    }
  } finally {
    client.release();
    await pool.end();
  }

  if (unexplained) {
    console.error(`\n${unexplained} unexplained delta(s) — cutover is blocked.`);
    process.exit(2);
  }
  console.log('\nZero unexplained delta.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
