#!/usr/bin/env node
/**
 * Step 2 — NULL-fill billing trigger fields on deployed rentals + vendor PO rates/start dates.
 * Default: --dry-run. Pass --commit to write. Re-runnable and transactional.
 */
require('dotenv').config();
const pool = require('../config/db');
const {
  gatherCustomerReadiness,
  gatherVendorReadiness,
  loadActivationContext,
  deriveRentStartDate,
  deriveRentMonthlyRate,
  loadVendorActivationRows,
  deriveVendorPoRate,
  deriveVendorSerialStart,
  writeMarkdownReport,
} = require('./lib/billingActivationUtils');

const commit = process.argv.includes('--commit');
const dryRun = !commit;

function parseLineItems(raw) {
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

async function buildPlan() {
  const ctx = await loadActivationContext(pool);
  const beforeCustomer = await gatherCustomerReadiness(pool);
  const beforeVendor = await gatherVendorReadiness(pool);

  const orphanRes = await pool.query(
    `SELECT vsn.serial_id, vsn.serial_number, vsn.current_customer_id
       FROM vendor_serial_numbers vsn
      WHERE vsn.current_customer_id IS NOT NULL
        AND vsn.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM customers c WHERE c.customer_id = vsn.current_customer_id
        )`
  );
  const orphanCustomers = orphanRes.rows;
  const orphanIds = new Set(orphanCustomers.map((r) => r.serial_id));

  const customerUpdates = [];
  const lowConfidence = [];
  const needsRate = [];

  for (const serial of ctx.serials) {
    if (orphanIds.has(serial.serial_id)) continue;

    const start = deriveRentStartDate(serial, ctx);
    const rate = deriveRentMonthlyRate(serial, ctx);

    const patch = {};
    if (!serial.rent_start_date && start.date) {
      patch.rent_start_date = start.date;
    }
    if (!parseFloat(serial.rent_monthly_rate || 0) && rate.rate) {
      patch.rent_monthly_rate = rate.rate;
    }

    if (Object.keys(patch).length) {
      customerUpdates.push({
        serial_id: serial.serial_id,
        serial_number: serial.serial_number,
        customer_id: serial.current_customer_id,
        patch,
        start_source: start.source,
        rate_source: rate.source,
        confidence: start.confidence,
      });
      if (start.confidence === 'low') {
        lowConfidence.push({
          serial_id: serial.serial_id,
          serial_number: serial.serial_number,
          rent_start_date: start.date,
          source: start.source,
        });
      }
    }

    if (!serial.rent_monthly_rate && !rate.rate) {
      needsRate.push({
        serial_id: serial.serial_id,
        serial_number: serial.serial_number,
        customer_id: serial.current_customer_id,
        dc_number: serial.current_dc_number,
      });
    }
  }

  const vendorRows = await loadVendorActivationRows(pool);
  const poUpdates = [];
  for (const po of vendorRows.pos) {
    const lineItems = parseLineItems(po.line_items);
    const derived = deriveVendorPoRate({ ...po, line_items: lineItems }, ctx);
    if (derived.rate) {
      const next = lineItems.length ? [...lineItems] : [{ quantity: 1 }];
      next[0] = { ...(next[0] || {}), rate: derived.rate };
      poUpdates.push({
        po_id: po.po_id,
        purchase_order_number: po.purchase_order_number,
        rate: derived.rate,
        source: derived.source,
        line_items: next,
      });
    }
  }

  const vendorSerialUpdates = [];
  for (const serial of vendorRows.serials) {
    const start = deriveVendorSerialStart(serial, ctx);
    if (start.date) {
      vendorSerialUpdates.push({
        serial_id: serial.serial_id,
        serial_number: serial.serial_number,
        po_id: serial.po_id,
        received_at: start.date,
        source: start.source,
      });
    }
  }

  return {
    beforeCustomer,
    beforeVendor,
    customerUpdates,
    lowConfidence,
    needsRate,
    orphanCustomers,
    poUpdates,
    vendorSerialUpdates,
  };
}

async function applyPlan(plan) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const row of plan.customerUpdates) {
      await client.query(
        `UPDATE vendor_serial_numbers
            SET rent_start_date = COALESCE(rent_start_date, $2::date),
                rent_monthly_rate = COALESCE(rent_monthly_rate, $3),
                updated_at = NOW()
          WHERE serial_id = $1
            AND deleted_at IS NULL`,
        [row.serial_id, row.patch.rent_start_date || null, row.patch.rent_monthly_rate ?? null]
      );
    }

    for (const po of plan.poUpdates) {
      await client.query(
        `UPDATE vendor_purchase_orders
            SET line_items = $2::jsonb, updated_at = NOW()
          WHERE po_id = $1
            AND (
              (line_items->0->>'rate') IS NULL
              OR COALESCE((line_items->0->>'rate')::numeric, 0) = 0
            )`,
        [po.po_id, JSON.stringify(po.line_items)]
      );
    }

    for (const row of plan.vendorSerialUpdates) {
      await client.query(
        `UPDATE vendor_serial_numbers
            SET rental_start_date = COALESCE(rental_start_date, $2::date),
                extra = jsonb_set(
                  COALESCE(extra, '{}'::jsonb),
                  '{received_at}',
                  to_jsonb($2::text),
                  true
                ),
                updated_at = NOW()
          WHERE serial_id = $1
            AND deleted_at IS NULL
            AND (extra->>'received_at') IS NULL
            AND rental_start_date IS NULL`,
        [row.serial_id, row.received_at]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function renderReport(plan, mode, afterCustomer, afterVendor) {
  const lines = [
    '# Billing Activation Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Mode: ${mode}`,
    '',
    '## Before',
    '',
    '```json',
    JSON.stringify({ customer: plan.beforeCustomer, vendor: plan.beforeVendor }, null, 2),
    '```',
    '',
    '## Customer NULL-fill plan',
    '',
    `- Serial updates planned: **${plan.customerUpdates.length}**`,
    `- Low-confidence start dates (created_at fallback): **${plan.lowConfidence.length}**`,
    `- Needs manual rate (excluded from billing): **${plan.needsRate.length}**`,
    `- Orphan customer_id (report only, not auto-fixed): **${plan.orphanCustomers.length}**`,
    '',
  ];

  if (plan.lowConfidence.length) {
    lines.push('### Low-confidence rent_start_date', '');
    lines.push('| serial_id | serial_number | date | source |');
    lines.push('|-----------|---------------|------|--------|');
    for (const r of plan.lowConfidence.slice(0, 100)) {
      lines.push(`| ${r.serial_id} | ${r.serial_number} | ${r.rent_start_date} | ${r.source} |`);
    }
    if (plan.lowConfidence.length > 100) lines.push(`\n_…and ${plan.lowConfidence.length - 100} more_`);
    lines.push('');
  }

  if (plan.needsRate.length) {
    lines.push('### needs_rate exceptions', '');
    lines.push('| serial_id | serial_number | customer_id | dc_number |');
    lines.push('|-----------|---------------|-------------|-----------|');
    for (const r of plan.needsRate.slice(0, 100)) {
      lines.push(`| ${r.serial_id} | ${r.serial_number} | ${r.customer_id} | ${r.dc_number || ''} |`);
    }
    if (plan.needsRate.length > 100) lines.push(`\n_…and ${plan.needsRate.length - 100} more_`);
    lines.push('');
  }

  if (plan.orphanCustomers.length) {
    lines.push('### Orphan current_customer_id', '');
    for (const r of plan.orphanCustomers.slice(0, 50)) {
      lines.push(`- serial ${r.serial_id} (${r.serial_number}) → customer_id ${r.current_customer_id}`);
    }
    lines.push('');
  }

  lines.push('## Vendor PO rate backfill', '');
  lines.push(`- PO line_items rate updates: **${plan.poUpdates.length}**`);
  lines.push(`- Serial received_at / rental_start_date updates: **${plan.vendorSerialUpdates.length}**`, '');

  if (afterCustomer) {
    lines.push('## After (--commit)', '');
    lines.push('```json');
    lines.push(JSON.stringify({ customer: afterCustomer, vendor: afterVendor }, null, 2));
    lines.push('```', '');
    lines.push('Re-run `node scripts/billing-readiness-report.js` before historical backfill.', '');
  } else if (dryRun) {
    lines.push('## Next step', '');
    lines.push('Review this report, then run `node scripts/activate-rental-billing-fields.js --commit`.', '');
  }

  return lines.join('\n');
}

(async () => {
  console.log(dryRun ? 'DRY RUN — no writes' : 'COMMIT — applying NULL-fill updates');
  const plan = await buildPlan();

  console.log(`Customer serial patches: ${plan.customerUpdates.length}`);
  console.log(`Vendor PO rate patches: ${plan.poUpdates.length}`);
  console.log(`Vendor serial start patches: ${plan.vendorSerialUpdates.length}`);
  console.log(`Needs rate (manual): ${plan.needsRate.length}`);
  console.log(`Low confidence starts: ${plan.lowConfidence.length}`);

  let afterCustomer;
  let afterVendor;
  if (commit) {
    await applyPlan(plan);
    afterCustomer = await gatherCustomerReadiness(pool);
    afterVendor = await gatherVendorReadiness(pool);
    console.log('After customer:', afterCustomer);
    console.log('After vendor:', afterVendor);
  }

  const md = renderReport(plan, dryRun ? 'dry-run' : 'commit', afterCustomer, afterVendor);
  const outPath = writeMarkdownReport('BILLING_ACTIVATION_REPORT.md', md);
  console.log(`Report written: ${outPath}`);

  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
