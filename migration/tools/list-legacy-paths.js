#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { getCrmPool, closePools } = require('../lib/db');
const { loadSchemaColumns, collectLegacyPaths } = require('./sync-path-utils');

async function main() {
  const crm = getCrmPool();
  const schema = await loadSchemaColumns(crm);
  const paths = await collectLegacyPaths(crm, schema);
  const tops = {};
  for (const p of paths) {
    const top = p.includes('/') ? p.split('/')[0] : '(root)';
    tops[top] = (tops[top] || 0) + 1;
  }
  console.log('total', paths.length);
  console.log(JSON.stringify(tops, null, 2));
  if (process.argv.includes('--write')) {
    const fs = require('fs');
    const out = path.join(__dirname, '..', 'logs', 'legacy-file-paths.txt');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, paths.join('\n'));
    console.log('wrote', out);
  }
  await closePools();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
