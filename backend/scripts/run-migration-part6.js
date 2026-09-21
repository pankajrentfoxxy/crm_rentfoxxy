/**
 * Part 6 migrations — 273 and 274.
 *
 *   273  billing GST split columns   (additive; nothing back-classified)
 *   274  invoice lifecycle           (additive + a due_date backfill)
 *
 * Usage: node scripts/run-migration-part6.js [--dry-run]
 *
 * Run Part 5's migrations first (scripts/run-migration-part5.js) — these do not
 * depend on them, but the branch order does.
 *
 * Staging shares the production database, so this IS a production run. Both
 * migrations are additive: 273 adds five columns to each billing table and
 * classifies nothing retrospectively, and 274 adds lifecycle columns and fills
 * due_date where it is NULL. No existing value is overwritten, so the backup
 * below is a record of the before state rather than a rollback path.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

const MIGRATIONS = [
  '273_billing_gst_split.sql',
  '274_invoice_lifecycle.sql',
];

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const client = await pool.connect();
  try {
    const before = await client.query(
      `SELECT COUNT(*)::int AS invoices,
              COUNT(*) FILTER (WHERE LOWER(COALESCE(status,'')) = 'sent')::int AS sent,
              COUNT(*) FILTER (WHERE LOWER(COALESCE(status,'')) = 'overdue')::int AS overdue
         FROM customer_invoices`
    );
    const bills = await client.query(`SELECT COUNT(*)::int AS n FROM vendor_monthly_bills`);
    console.log('invoices:', JSON.stringify(before.rows[0]), '| vendor bills:', bills.rows[0].n);

    const backupDir = path.join(__dirname, '../backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `part6-${stamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify({
      taken_at: new Date().toISOString(),
      note: 'Both migrations are additive. This records the before state; no value is overwritten.',
      invoice_counts: before.rows[0],
      vendor_bill_count: bills.rows[0].n,
    }, null, 2));
    console.log('Backup ->', backupPath);

    await client.query('BEGIN');
    for (const name of MIGRATIONS) {
      await client.query(fs.readFileSync(path.join(__dirname, '../migrations', name), 'utf8'));
      if (!DRY_RUN) {
        await client.query(
          `INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
          [name]
        );
      }
      console.log('applied:', name);
    }

    const after = await client.query(
      `SELECT COUNT(*) FILTER (WHERE due_date IS NOT NULL)::int AS with_due_date,
              COUNT(*) FILTER (WHERE is_intra_state IS NULL)::int AS unclassified_gst,
              COUNT(*)::int AS total
         FROM customer_invoices`
    );
    const wouldGoOverdue = await client.query(
      `SELECT COUNT(*)::int AS n FROM customer_invoices
        WHERE LOWER(COALESCE(status,'')) = 'sent'
          AND due_date IS NOT NULL AND due_date < CURRENT_DATE
          AND COALESCE(amount_paid,0) < COALESCE(grand_total,0)`
    );

    if (DRY_RUN) {
      await client.query('ROLLBACK');
      console.log('\n--- DRY RUN: everything above was rolled back ---');
    } else {
      await client.query('COMMIT');
      console.log('\n--- committed ---');
    }

    console.log('invoices with a due date          :', after.rows[0].with_due_date, '/', after.rows[0].total);
    console.log('invoices with no GST class yet    :', after.rows[0].unclassified_gst,
      '(expected: all of them — nothing is back-classified)');
    console.log('invoices the first sweep will move:', wouldGoOverdue.rows[0].n);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
