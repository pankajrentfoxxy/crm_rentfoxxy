#!/usr/bin/env node
/**
 * Master ERP → CRM migration runner.
 *
 * Usage:
 *   cp .env.example .env   # configure connections
 *   npm install
 *   node migrate-all.js              # requires MIGRATION_APPROVED=true after review
 *   node migrate-all.js --force      # re-run completed modules
 *   node migrate-all.js --only=007   # single module
 */
const config = require('./lib/config');
const { initMigrationInfrastructure, runModule, loadModules, closePools } = require('./lib/runner');
const { writeLog } = require('./lib/logger');

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const onlyId = onlyArg ? onlyArg.split('=')[1] : null;

  if (!config.approved && !args.includes('--dry-run')) {
    console.error(`
╔══════════════════════════════════════════════════════════════════╗
║  MIGRATION BLOCKED — Pre-migration review required               ║
╠══════════════════════════════════════════════════════════════════╣
║  1. Read migration/PRE_MIGRATION_REVIEW.md                       ║
║  2. Read migration/AUTH_TABLES.md + SYSTEM_TABLES.md             ║
║  3. Resolve manual decisions                                     ║
║  3. Set MIGRATION_APPROVED=true in migration/.env                ║
║  4. Re-run: node migrate-all.js                                  ║
║                                                                  ║
║  Dry-run (connectivity + counts only):                           ║
║    node migrate-all.js --dry-run                                 ║
╚══════════════════════════════════════════════════════════════════╝
`);
    process.exit(1);
  }

  writeLog('migration', '=== ERP → CRM Migration Started ===');

  try {
    if (args.includes('--dry-run')) {
      writeLog('migration', 'DRY RUN — listing modules only');
      const modules = loadModules();
      if (onlyId) {
        const filtered = modules.filter((m) => m.id === onlyId);
        if (!filtered.length) throw new Error(`Module ${onlyId} not found`);
        for (const m of filtered) writeLog('migration', `  ${m.id} ${m.name}`);
      } else {
        for (const m of modules) writeLog('migration', `  ${m.id} ${m.name}`);
      }
      writeLog('migration', 'Dry run complete (no data migrated)');
      return;
    }

    await initMigrationInfrastructure();
    let modules = loadModules();

    if (onlyId) {
      modules = modules.filter((m) => m.id === onlyId);
      if (!modules.length) throw new Error(`Module ${onlyId} not found`);
    }

    let totalRows = 0;
    for (const mod of modules) {
      const result = await runModule(mod, { force });
      totalRows += result.rowsMigrated || 0;
    }

    writeLog('migration', `=== Migration Completed Successfully (${totalRows} rows) ===`);
  } catch (err) {
    writeLog('migration', `=== Migration FAILED: ${err.message} ===`);
    console.error(err);
    process.exitCode = 1;
  } finally {
    await closePools();
  }
}

main();
