#!/usr/bin/env node
/**
 * Production wrapper — run from backend/ with CRM DATABASE_URL.
 *   node scripts/run-leads-tickets-resync.js --force
 */
const { spawnSync } = require('child_process');
const path = require('path');

const migrationDir = path.join(__dirname, '..', '..', 'migration');
const args = process.argv.slice(2);
const r = spawnSync(process.execPath, [path.join(migrationDir, 'run-leads-tickets-resync.js'), ...args], {
  stdio: 'inherit',
  cwd: migrationDir,
  env: process.env,
});
process.exit(r.status ?? 1);
