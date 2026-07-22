#!/usr/bin/env node
/**
 * Migrate Leads + Floor Tickets from laptop_refurbishment backup → CRM.
 *
 * Prerequisites:
 *   1. Restore laptop_refurbishment_backup.sql into a PostgreSQL database
 *   2. Configure migration/.env:
 *        REFURB_DATABASE_URL=postgresql://user:pass@host:5432/laptop_refurbishment
 *        DATABASE_URL=postgresql://... (CRM target)
 *        MIGRATION_APPROVED=true
 *
 * Usage:
 *   cd migration
 *   npm run reconcile:leads-tickets          # before
 *   npm run migrate:leads-tickets:force     # run 033 + 034 + 035
 *   npm run reconcile:leads-tickets          # after
 *
 * Options:
 *   --only=033|034|035
 *   --force
 *   --skip-reconcile
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { spawnSync } = require('child_process');
const path = require('path');
const config = require('./lib/config');
const { initRefurbMigrationInfrastructure, runRefurbModule, closePools } = require('./lib/refurbRunner');
const { writeLog } = require('./lib/logger');

const mod033 = require('./scripts/033_refurb_leads');
const mod034 = require('./scripts/034_refurb_tickets');
const mod035 = require('./scripts/035_lead_assignments_resync');

function runReconcile(label) {
  console.log(`\n--- Reconciliation (${label}) ---`);
  const r = spawnSync(process.execPath, [path.join(__dirname, 'tools', 'reconcile-leads-tickets.js')], {
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

  writeLog('migration', '=== Leads + Tickets refurb migration started ===');
  if (!skipReconcile) runReconcile('BEFORE');

  await initRefurbMigrationInfrastructure();

  const modules = [mod033, mod034, mod035].filter((m) => !onlyId || m.id === onlyId);
  if (!modules.length) throw new Error(`Module ${onlyId} not found`);

  let total = 0;
  for (const mod of modules) {
    const result = await runRefurbModule(mod, { force });
    total += result.rowsMigrated || 0;
    console.log(`Module ${mod.id} ${mod.name}:`, result.skipped ? 'skipped' : `${result.rowsMigrated} rows`);
  }

  if (!skipReconcile) runReconcile('AFTER');

  writeLog('migration', `=== Leads + Tickets refurb migration done (${total} rows) ===`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
}).finally(() => closePools());
