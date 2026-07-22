#!/usr/bin/env node
/**
 * Resync ERP inward_outward → CRM (module 041).
 *
 * Usage:
 *   cd migration && set MIGRATION_APPROVED=true && node run-inward-outward-resync.js --force
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', 'backend', '.env') });
const { initMigrationInfrastructure, runModule, closePools } = require('./lib/runner');
const mod041 = require('./scripts/041_inward_outward');

async function main() {
  if (process.env.MIGRATION_APPROVED !== 'true') {
    console.error('Set MIGRATION_APPROVED=true to run inward_outward resync.');
    process.exit(1);
  }
  const force = process.argv.includes('--force');
  await initMigrationInfrastructure();
  const result = await runModule(mod041, { force });
  console.log('041 inward_outward:', result);
  await closePools();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
