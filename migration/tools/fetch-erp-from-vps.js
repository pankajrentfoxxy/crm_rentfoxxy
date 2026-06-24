#!/usr/bin/env node
/**
 * Fetch CRM-referenced ERP files from VPS via SSH/SCP.
 *
 * Usage:
 *   node tools/fetch-erp-from-vps.js --dry-run
 *   node tools/fetch-erp-from-vps.js --apply
 *
 * Env (migration/.env):
 *   VPS_SSH_KEY=C:/Users/Dell/Downloads/LightsailDefaultKey-ap-south-1.pem
 *   VPS_HOST=ubuntu@43.205.189.249
 *   VPS_ERP_PUBLIC=/www/wwwroot/erp.rentfoxxy.com/api/storage/app/public
 *   ERP_STORAGE_ROOT=./erp-storage
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const config = require('../lib/config');
const { getCrmPool, closePools } = require('../lib/db');
const { writeLog } = require('../lib/logger');
const { normalizeErpPath } = require('../lib/fileSync');
const { loadSchemaColumns, collectLegacyPaths } = require('./sync-path-utils');

const SSH_KEY = process.env.VPS_SSH_KEY || 'C:/Users/Dell/Downloads/LightsailDefaultKey-ap-south-1.pem';
const VPS_HOST = process.env.VPS_HOST || 'ubuntu@43.205.189.249';
const REMOTE_ROOT =
  process.env.VPS_ERP_PUBLIC || '/www/wwwroot/erp.rentfoxxy.com/api/storage/app/public';
const LOCAL_ROOT =
  config.erpStorageRoot || path.join(__dirname, '..', 'erp-storage');

function sh(cmd) {
  writeLog('migration', cmd.replace(SSH_KEY, '[key]'));
  execSync(cmd, { stdio: 'inherit', shell: true });
}

async function main() {
  const apply = process.argv.includes('--apply');
  const dryRun = !apply;

  if (!fs.existsSync(SSH_KEY)) {
    console.error(`SSH key not found: ${SSH_KEY}`);
    process.exit(1);
  }

  const crm = getCrmPool();
  const schema = await loadSchemaColumns(crm);
  const rawPaths = await collectLegacyPaths(crm, schema);
  await closePools();

  const paths = [...new Set(rawPaths.map(normalizeErpPath).filter(Boolean))].sort();
  writeLog('migration', `Fetch ERP files: ${paths.length} normalized paths from CRM DB`);

  const logsDir = path.join(__dirname, '..', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const listFile = path.join(logsDir, 'fetch-paths.txt');
  fs.writeFileSync(listFile, paths.join('\n'));

  const remoteList = '/tmp/crm-fetch-paths.txt';
  const remoteTar = '/tmp/crm-erp-files.tar.gz';
  const localTar = path.join(logsDir, 'crm-erp-files.tar.gz');

  if (dryRun) {
    const tops = {};
    for (const p of paths) {
      const top = p.includes('/') ? p.split('/')[0] : '(root)';
      tops[top] = (tops[top] || 0) + 1;
    }
    console.log('Paths by folder:', tops);
    console.log(`Would fetch ${paths.length} files to ${LOCAL_ROOT}`);
    console.log('Re-run with --apply to download.');
    return;
  }

  fs.mkdirSync(LOCAL_ROOT, { recursive: true });

  sh(
    `scp -i "${SSH_KEY}" -o StrictHostKeyChecking=accept-new "${listFile}" ${VPS_HOST}:${remoteList}`
  );

  const remoteScriptLocal = path.join(logsDir, 'fetch-remote.sh');
  const remoteScriptBody = `#!/bin/bash
set -e
ROOT="${REMOTE_ROOT.replace(/"/g, '\\"')}"
cd "$ROOT"
: > /tmp/crm-fetch-found.txt
: > /tmp/crm-fetch-missing.txt
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if [ -f "$f" ]; then echo "$f" >> /tmp/crm-fetch-found.txt; else echo "$f" >> /tmp/crm-fetch-missing.txt; fi
done < ${remoteList}
FOUND=$(wc -l < /tmp/crm-fetch-found.txt | tr -d ' ')
MISS=$(wc -l < /tmp/crm-fetch-missing.txt | tr -d ' ')
echo "Found $FOUND files, missing $MISS"
tar czf ${remoteTar} -C "$ROOT" -T /tmp/crm-fetch-found.txt
ls -lh ${remoteTar}
`;
  fs.writeFileSync(remoteScriptLocal, remoteScriptBody, { mode: 0o755 });

  sh(`scp -i "${SSH_KEY}" "${remoteScriptLocal}" ${VPS_HOST}:/tmp/fetch-remote.sh`);
  sh(`ssh -i "${SSH_KEY}" ${VPS_HOST} "bash /tmp/fetch-remote.sh"`);

  if (fs.existsSync(localTar)) fs.unlinkSync(localTar);
  sh(`scp -i "${SSH_KEY}" ${VPS_HOST}:${remoteTar} "${localTar}"`);

  sh(`tar xzf "${localTar}" -C "${LOCAL_ROOT}"`);

  sh(
    `scp -i "${SSH_KEY}" ${VPS_HOST}:/tmp/crm-fetch-missing.txt "${path.join(logsDir, 'fetch-missing.txt')}"`
  );

  writeLog('migration', `Fetch complete -> ${LOCAL_ROOT}`);
  console.log(`\nFiles extracted to ${LOCAL_ROOT}`);
  console.log('Next: set ERP_STORAGE_ROOT in migration/.env and run:');
  console.log('  node tools/sync-erp-files.js --apply');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
