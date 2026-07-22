#!/usr/bin/env node
/**
 * Step 1 — Read-only billing readiness diagnostic.
 * Prints customer + vendor coverage counts (go/no-go gate before activation).
 *
 * Flags:
 *   --preflight   Warn only (exit 0) — for pipeline step 1 before activation
 *   --strict      Default verify mode after activation
 */
require('dotenv').config();
const pool = require('../config/db');
const {
  gatherCustomerReadiness,
  gatherVendorReadiness,
  gatherDeployedStatusBreakdown,
  evaluateCustomerBlockers,
  evaluateVendorBlockers,
} = require('./lib/billingActivationUtils');

const preflight = process.argv.includes('--preflight');
const strict = !preflight;

(async () => {
  const customer = await gatherCustomerReadiness(pool);
  const vendor = await gatherVendorReadiness(pool);
  const statusBreakdown = await gatherDeployedStatusBreakdown(pool);

  const customerEval = evaluateCustomerBlockers(customer, { strict });
  const vendorEval = evaluateVendorBlockers(vendor, { strict });

  const report = {
    generated_at: new Date().toISOString(),
    mode: preflight ? 'preflight' : 'strict',
    customer,
    vendor,
    deployed_status_breakdown: statusBreakdown,
    go_no_go: {
      customer_ready:
        customer.eligible_status > 0
        && customer.missing_rent_start === 0
        && customer.missing_rate === 0
        && customer.orphan_customer === 0,
      vendor_ready: vendor.missing_po_rate === 0 && vendor.missing_start_date === 0,
    },
  };

  console.log(JSON.stringify(report, null, 2));

  const allBlockers = [...customerEval.blockers, ...vendorEval.blockers];
  const autoFix = [...customerEval.autoFix, ...vendorEval.autoFix];

  if (autoFix.length) {
    console.log('\nWill be fixed by activate-rental-billing-fields.js --commit:');
    for (const b of autoFix) console.log(`  - ${b}`);
  }

  if (allBlockers.length) {
    console.error(`\nBlockers${preflight ? ' (preflight — continuing pipeline)' : ''}:`);
    for (const b of allBlockers) console.error(`  - ${b}`);
    if (strict) process.exitCode = 1;
  } else {
    console.log('\nCoverage OK — eligible for historical backfill.');
  }

  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
