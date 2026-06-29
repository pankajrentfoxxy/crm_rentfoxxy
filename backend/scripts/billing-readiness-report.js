#!/usr/bin/env node
/**
 * Step 1 — Read-only billing readiness diagnostic.
 * Prints customer + vendor coverage counts (go/no-go gate before activation).
 */
require('dotenv').config();
const pool = require('../config/db');
const {
  gatherCustomerReadiness,
  gatherVendorReadiness,
} = require('./lib/billingActivationUtils');

(async () => {
  const customer = await gatherCustomerReadiness(pool);
  const vendor = await gatherVendorReadiness(pool);

  const report = {
    generated_at: new Date().toISOString(),
    customer,
    vendor,
    go_no_go: {
      customer_ready:
        customer.missing_rent_start === 0 && customer.missing_rate === 0 && customer.orphan_customer === 0,
      vendor_ready: vendor.missing_po_rate === 0 && vendor.missing_start_date === 0,
    },
  };

  console.log(JSON.stringify(report, null, 2));

  const blockers = [];
  if (customer.missing_rent_start > 0) {
    blockers.push(`${customer.missing_rent_start} deployed serial(s) missing rent_start_date`);
  }
  if (customer.missing_rate > 0) {
    blockers.push(`${customer.missing_rate} deployed serial(s) missing rent_monthly_rate`);
  }
  if (customer.orphan_customer > 0) {
    blockers.push(`${customer.orphan_customer} serial(s) with orphan current_customer_id`);
  }
  if (vendor.missing_po_rate > 0) {
    blockers.push(`${vendor.missing_po_rate} vendor rental serial(s) missing PO line rate`);
  }
  if (vendor.missing_start_date > 0) {
    blockers.push(`${vendor.missing_start_date} vendor rental serial(s) missing start date`);
  }

  if (blockers.length) {
    console.error('\nBlockers (run activate-rental-billing-fields.js --dry-run first):');
    for (const b of blockers) console.error(`  - ${b}`);
    process.exitCode = 1;
  } else {
    console.log('\nCoverage OK — eligible for historical backfill.');
  }

  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
