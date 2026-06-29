#!/usr/bin/env node
/**
 * Run the full billing activation pipeline in order.
 * Default: dry-run for activation + backfill (read-only / plan only).
 * Pass --commit to write activation fields AND generate historical invoices/bills.
 *
 * Usage:
 *   node scripts/run-billing-activation-pipeline.js
 *   node scripts/run-billing-activation-pipeline.js --commit
 *   node scripts/run-billing-activation-pipeline.js --commit --from=2024-01 --until=2026-06
 */
const { spawnSync } = require('child_process');
const path = require('path');

const commit = process.argv.includes('--commit');
const extraArgs = process.argv.slice(2).filter((a) => a !== '--commit');

function run(label, script, args = []) {
  console.log(`\n========== ${label} ==========\n`);
  const res = spawnSync(process.execPath, [path.join(__dirname, script), ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  if (res.status !== 0) {
    console.error(`\n${label} failed (exit ${res.status}). Stopping pipeline.`);
    process.exit(res.status || 1);
  }
}

console.log(commit ? 'PIPELINE: COMMIT mode (will write to DB)' : 'PIPELINE: DRY RUN (no writes — pass --commit to populate invoices)');

run('Step 1 — Readiness diagnostic', 'billing-readiness-report.js');

const activationArgs = commit ? ['--commit'] : [];
run('Step 2 — Activate rental billing fields', 'activate-rental-billing-fields.js', activationArgs);

run('Step 1 (verify) — Readiness after activation', 'billing-readiness-report.js');

const backfillArgs = commit ? ['--commit', ...extraArgs] : [...extraArgs];
run('Step 3 — Historical invoice/bill backfill', 'backfill-historical-invoices.js', backfillArgs);

run('Final state check', 'check-billing-state.js');

console.log('\nPipeline complete.');
if (!commit) {
  console.log('\nNo invoices were created (dry-run). On production, run:');
  console.log('  node scripts/run-billing-activation-pipeline.js --commit');
}
