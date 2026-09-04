/**
 * Apply the next-month billing window to existing September 2026 drafts:
 * - drop security that was not delivered in August
 * - drop rental for units that started in September
 *
 * Usage: node scripts/fix-sept-2026-billing-window.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
process.env.DB_SSL = process.env.DB_SSL || 'false';

const pool = require('../config/db');
const {
  reconcileDraftRentalWindow,
  ensureInvoiceSecurityLines,
} = require('../services/billingSchedulerService');

const MONTH = 9;
const YEAR = 2026;

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inv = await client.query(
      `SELECT invoice_id, invoice_number, customer_id, status, line_items,
              subtotal, gst_percent, credit_note_adjustment, security_deposit
         FROM customer_invoices
        WHERE invoice_month = $1 AND invoice_year = $2 AND status = 'draft'
        FOR UPDATE`,
      [MONTH, YEAR]
    );
    const summary = [];
    for (const row of inv.rows) {
      const stripped = await reconcileDraftRentalWindow(client, row, MONTH, YEAR);
      const security = await ensureInvoiceSecurityLines(client, {
        customerId: row.customer_id,
        invoiceId: row.invoice_id,
        month: MONTH,
        year: YEAR,
      });
      if (stripped.stripped || security.added || security.removed) {
        summary.push({
          invoice: row.invoice_number,
          customer_id: row.customer_id,
          rental_stripped: stripped.stripped,
          security_added: security.added,
          security_removed: security.removed,
          security_total: security.security_total,
        });
      }
    }
    await client.query('COMMIT');
    console.log(JSON.stringify({ updated: summary.length, invoices: summary }, null, 2));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
