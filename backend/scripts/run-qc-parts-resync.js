/**
 * Production entry: QC + Spare Parts ERP resync (modules 031 + 032).
 * Delegates to migration/run-qc-parts-resync.js
 *
 * Usage on server:
 *   cd /var/www/crm_rentfoxxy/backend
 *   node scripts/run-qc-parts-resync.js
 *   node scripts/run-qc-parts-resync.js --force
 */
const { spawnSync } = require('child_process');
const path = require('path');

const migrationDir = path.join(__dirname, '..', '..', 'migration');
const script = path.join(migrationDir, 'run-qc-parts-resync.js');
const args = [script, ...process.argv.slice(2)];

const r = spawnSync(process.execPath, args, {
  stdio: 'inherit',
  cwd: migrationDir,
  env: process.env,
});

process.exit(r.status ?? 1);
