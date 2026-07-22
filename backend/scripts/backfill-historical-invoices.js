#!/usr/bin/env node
/**
 * Step 3 — Month-by-month historical invoice/bill generation using the existing billing engine.
 * Default: --dry-run. Pass --commit to write.
 *
 * Options:
 *   --from=YYYY-MM   earliest month (optional; defaults to entity earliest start)
 *   --until=YYYY-MM  last month to generate (optional)
 *     customers: default current month (prepaid)
 *     vendors: default last completed month (postpaid)
 */
require('dotenv').config();
const pool = require('../config/db');
const {
  generateCustomerInvoice,
  generateVendorBill,
} = require('../services/billingSchedulerService');
const {
  parseYm,
  ymFromDate,
  ymKey,
  monthRange,
  currentMonthYm,
  lastCompletedMonthYm,
  writeMarkdownReport,
} = require('./lib/billingActivationUtils');

const commit = process.argv.includes('--commit');
const dryRun = !commit;

function argValue(prefix) {
  const hit = process.argv.find((a) => a.startsWith(`${prefix}=`));
  return hit ? hit.slice(prefix.length + 1) : null;
}

const fromArg = parseYm(argValue('--from'));
const untilArg = parseYm(argValue('--until'));

async function loadCustomerTargets() {
  const res = await pool.query(
    `SELECT current_customer_id AS customer_id,
            MIN(rent_start_date)::text AS earliest_start,
            COUNT(*)::int AS serial_count
       FROM vendor_serial_numbers
      WHERE current_customer_id IS NOT NULL
        AND deleted_at IS NULL
        AND inventory_status IN ('rented', 'returned')
        AND rent_start_date IS NOT NULL
        AND rent_monthly_rate IS NOT NULL
        AND rent_monthly_rate > 0
      GROUP BY current_customer_id
      ORDER BY current_customer_id`
  );
  return res.rows;
}

async function loadVendorTargets() {
  const res = await pool.query(
    `SELECT vpo.vendor_id,
            MIN(COALESCE(
              (vsn.extra->>'received_at')::date,
              vsn.rental_start_date,
              vsn.created_at::date
            ))::text AS earliest_start,
            COUNT(*)::int AS serial_count
       FROM vendor_serial_numbers vsn
       JOIN vendor_purchase_orders vpo ON vpo.po_id = vsn.po_id
      WHERE vpo.deleted_at IS NULL
        AND vsn.deleted_at IS NULL
        AND vpo.purchase_order_type IN ('rental_purchase', 'rent_to_own')
        AND COALESCE((vpo.line_items->0->>'rate')::numeric, 0) > 0
        AND COALESCE(
              (vsn.extra->>'received_at')::date,
              vsn.rental_start_date,
              vsn.created_at::date
            ) IS NOT NULL
      GROUP BY vpo.vendor_id
      ORDER BY vpo.vendor_id`
  );
  return res.rows;
}

async function existingCustomerInvoices() {
  const res = await pool.query(
    `SELECT customer_id, invoice_year, invoice_month
       FROM customer_invoices`
  );
  const set = new Set();
  for (const r of res.rows) {
    set.add(`${r.customer_id}:${r.invoice_year}-${String(r.invoice_month).padStart(2, '0')}`);
  }
  return set;
}

async function existingVendorBills() {
  const res = await pool.query(
    `SELECT vendor_id, bill_year, bill_month FROM vendor_monthly_bills`
  );
  const set = new Set();
  for (const r of res.rows) {
    set.add(`${r.vendor_id}:${r.bill_year}-${String(r.bill_month).padStart(2, '0')}`);
  }
  return set;
}

function planMonths(earliestStart, defaultUntil, globalFrom) {
  const startYm = globalFrom || ymFromDate(earliestStart);
  if (!startYm) return [];
  return monthRange(startYm, defaultUntil);
}

async function runCustomerBackfill(defaultUntil) {
  const targets = await loadCustomerTargets();
  const existing = dryRun ? await existingCustomerInvoices() : null;
  const results = [];
  const errors = [];

  for (const row of targets) {
    const months = planMonths(row.earliest_start, defaultUntil, fromArg);
    for (const m of months) {
      const key = `${row.customer_id}:${ymKey(m)}`;
      if (dryRun) {
        const wouldSkip = existing.has(key);
        results.push({
          party_type: 'customer',
          party_id: row.customer_id,
          month: m.month,
          year: m.year,
          action: wouldSkip ? 'skip_existing' : 'would_generate',
        });
        continue;
      }

      try {
        const out = await generateCustomerInvoice(row.customer_id, m.month, m.year);
        results.push({
          party_type: 'customer',
          party_id: row.customer_id,
          month: m.month,
          year: m.year,
          ...out,
        });
      } catch (err) {
        errors.push({
          party_type: 'customer',
          party_id: row.customer_id,
          month: m.month,
          year: m.year,
          error: err.message,
        });
      }
    }
  }

  return { results, errors, entityCount: targets.length };
}

async function runVendorBackfill(defaultUntil) {
  const targets = await loadVendorTargets();
  const existing = dryRun ? await existingVendorBills() : null;
  const results = [];
  const errors = [];

  for (const row of targets) {
    const months = planMonths(row.earliest_start, defaultUntil, fromArg);
    for (const m of months) {
      const key = `${row.vendor_id}:${ymKey(m)}`;
      if (dryRun) {
        const wouldSkip = existing.has(key);
        results.push({
          party_type: 'vendor',
          party_id: row.vendor_id,
          month: m.month,
          year: m.year,
          action: wouldSkip ? 'skip_existing' : 'would_generate',
        });
        continue;
      }

      try {
        const out = await generateVendorBill(row.vendor_id, m.month, m.year);
        results.push({
          party_type: 'vendor',
          party_id: row.vendor_id,
          month: m.month,
          year: m.year,
          ...out,
        });
      } catch (err) {
        errors.push({
          party_type: 'vendor',
          party_id: row.vendor_id,
          month: m.month,
          year: m.year,
          error: err.message,
        });
      }
    }
  }

  return { results, errors, entityCount: targets.length };
}

function summarize(results) {
  const byMonth = new Map();
  let generated = 0;
  let skipped = 0;
  let wouldGenerate = 0;

  for (const r of results) {
    const k = ymKey({ year: r.year, month: r.month });
    if (!byMonth.has(k)) byMonth.set(k, { generated: 0, skipped: 0, would_generate: 0 });
    const bucket = byMonth.get(k);

    if (r.action === 'would_generate') {
      wouldGenerate += 1;
      bucket.would_generate += 1;
    } else if (r.skipped || r.action === 'skip_existing') {
      skipped += 1;
      bucket.skipped += 1;
    } else if (r.invoice_id || r.bill_id) {
      generated += 1;
      bucket.generated += 1;
    }
  }

  return { byMonth, generated, skipped, wouldGenerate };
}

function renderReport({ customer, vendor, customerUntil, vendorUntil, mode }) {
  const custSummary = summarize(customer.results);
  const vendSummary = summarize(vendor.results);

  const lines = [
    '# Historical Backfill Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Mode: ${mode}`,
    `Customer until: ${ymKey(customerUntil)}`,
    `Vendor until: ${ymKey(vendorUntil)}`,
    fromArg ? `From override: ${ymKey(fromArg)}` : 'From override: (entity earliest start)',
    '',
    '## Summary',
    '',
    `| Side | Entities | Generated | Skipped | Would generate | Errors |`,
    `|------|----------|-----------|---------|----------------|--------|`,
    `| Customer | ${customer.entityCount} | ${custSummary.generated} | ${custSummary.skipped} | ${custSummary.wouldGenerate} | ${customer.errors.length} |`,
    `| Vendor | ${vendor.entityCount} | ${vendSummary.generated} | ${vendSummary.skipped} | ${vendSummary.wouldGenerate} | ${vendor.errors.length} |`,
    '',
    '## By month (customer)',
    '',
    '| Month | Generated | Skipped | Would generate |',
    '|-------|-----------|---------|----------------|',
  ];

  for (const [month, stats] of [...custSummary.byMonth.entries()].sort()) {
    lines.push(`| ${month} | ${stats.generated} | ${stats.skipped} | ${stats.would_generate} |`);
  }

  lines.push('', '## By month (vendor)', '');
  lines.push('| Month | Generated | Skipped | Would generate |');
  lines.push('|-------|-----------|---------|----------------|');
  for (const [month, stats] of [...vendSummary.byMonth.entries()].sort()) {
    lines.push(`| ${month} | ${stats.generated} | ${stats.skipped} | ${stats.would_generate} |`);
  }

  const allErrors = [...customer.errors, ...vendor.errors];
  if (allErrors.length) {
    lines.push('', '## Errors', '');
    for (const e of allErrors.slice(0, 100)) {
      lines.push(`- ${e.party_type} ${e.party_id} ${ymKey({ year: e.year, month: e.month })}: ${e.error}`);
    }
    if (allErrors.length > 100) lines.push(`\n_…and ${allErrors.length - 100} more errors_`);
  }

  if (dryRun) {
    lines.push('', '## Next step', '');
    lines.push('Run `node scripts/backfill-historical-invoices.js --commit` after activation.', '');
  } else {
    lines.push('', '## Verification', '');
    lines.push('Re-run this script with `--commit` — expect 0 new invoices/bills (full idempotency).', '');
    lines.push('Then run `node scripts/billing-readiness-report.js`.', '');
  }

  return lines.join('\n');
}

(async () => {
  const customerUntil = untilArg || currentMonthYm();
  const vendorUntil = untilArg || lastCompletedMonthYm();

  console.log(dryRun ? 'DRY RUN — plan only' : 'COMMIT — generating month-by-month');
  console.log(`Customer until: ${ymKey(customerUntil)}`);
  console.log(`Vendor until: ${ymKey(vendorUntil)}`);

  const customer = await runCustomerBackfill(customerUntil);
  const vendor = await runVendorBackfill(vendorUntil);

  const custSummary = summarize(customer.results);
  const vendSummary = summarize(vendor.results);

  console.log('Customer:', custSummary);
  console.log('Vendor:', vendSummary);
  if (customer.errors.length + vendor.errors.length) {
    console.error('Errors:', customer.errors.length + vendor.errors.length);
  }

  const md = renderReport({
    customer,
    vendor,
    customerUntil,
    vendorUntil,
    mode: dryRun ? 'dry-run' : 'commit',
  });
  const outPath = writeMarkdownReport('HISTORICAL_BACKFILL_REPORT.md', md);
  console.log(`Report written: ${outPath}`);

  await pool.end();
  if (customer.errors.length + vendor.errors.length) process.exitCode = 1;
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
