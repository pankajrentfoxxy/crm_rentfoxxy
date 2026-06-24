#!/usr/bin/env node
/**
 * Run QC + Spare Parts resync modules (031, 032) with before/after reconciliation.
 *
 * Local (SQL dump, no MySQL):
 *   cd migration
 *   set ERP_USE_SQL_DUMP=true
 *   set MIGRATION_APPROVED=true
 *   node run-qc-parts-resync.js
 *
 * Production (live ERP MySQL):
 *   cd migration
 *   set MIGRATION_APPROVED=true
 *   node run-qc-parts-resync.js --env=production
 *
 * Options:
 *   --only=031|032   Run one module
 *   --force          Re-run even if marked completed
 *   --skip-reconcile   Skip before/after report
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { spawnSync } = require('child_process');
const path = require('path');
const config = require('./lib/config');
const { initMigrationInfrastructure, runModule, closePools } = require('./lib/runner');
const { writeLog } = require('./lib/logger');

const mod031 = require('./scripts/031_qc_process_resync');
const mod032 = require('./scripts/032_spare_parts_full_resync');

function runReconcile(label) {
  console.log(`\n--- Reconciliation (${label}) ---`);
  const r = spawnSync(process.execPath, [path.join(__dirname, 'tools', 'reconcile-qc-parts.js')], {
    stdio: 'inherit',
    env: process.env,
  });
  if (r.status !== 0) process.exit(r.status || 1);
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const skipReconcile = args.includes('--skip-reconcile');
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const onlyId = onlyArg ? onlyArg.split('=')[1] : null;

  if (!config.approved) {
    console.error('Set MIGRATION_APPROVED=true in migration/.env before running.');
    process.exit(1);
  }

  writeLog('migration', '=== QC + Spare Parts resync started ===');
  if (!skipReconcile) runReconcile('BEFORE');

  await initMigrationInfrastructure();

  const modules = [mod031, mod032].filter((m) => !onlyId || m.id === onlyId);
  if (!modules.length) throw new Error(`Module ${onlyId} not found`);

  let total = 0;
  for (const mod of modules) {
    const result = await runModule(mod, { force });
    total += result.rowsMigrated || 0;
    console.log(`Module ${mod.id} ${mod.name}:`, result.skipped ? 'skipped' : `${result.rowsMigrated} rows`);
  }

  if (!skipReconcile) runReconcile('AFTER');

  writeLog('migration', `=== QC + Spare Parts resync done (${total} rows) ===`);
  console.log('\nDone. Deploy backend filter fix (inventoryManagementService qc_process=pending) if not already live.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(() => closePools());
