#!/usr/bin/env node
/**
 * Copy ERP Laravel storage files into CRM backend/uploads and rewrite DB paths.
 *
 * SQL migration (module 030) stores ERP paths only — binaries are NOT copied.
 * Run this tool after migrate-all.js when you have ERP storage/app/public on disk.
 *
 * Usage:
 *   node tools/sync-erp-files.js --dry-run
 *   node tools/sync-erp-files.js --apply
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const config = require('../lib/config');
const { getCrmPool, closePools } = require('../lib/db');
const { writeLog } = require('../lib/logger');
const {
  normalizeErpPath,
  crmRelativePath,
  resolveErpSourceFile,
  destAbsolutePath,
  copyFileSafe,
} = require('../lib/fileSync');
const {
  TEXT_COLUMNS,
  JSONB_COLUMNS,
  loadSchemaColumns,
  collectLegacyPaths,
} = require('./sync-path-utils');

async function rewriteDbPaths(crm, mapping, schema) {
  let updated = 0;

  async function replaceColumn(table, column, isJsonb = false) {
    const cols = schema.get(table);
    if (!cols || !cols.has(column)) return;

    const touchUpdated = cols.has('updated_at') ? ', updated_at = NOW()' : '';

    for (const [from, to] of mapping.entries()) {
      if (from === to) continue;
      const sql = isJsonb
        ? `UPDATE ${table}
             SET ${column} = REPLACE(${column}::text, $1, $2)::jsonb${touchUpdated}
           WHERE ${column}::text LIKE '%' || $1 || '%'`
        : `UPDATE ${table}
             SET ${column} = $2${touchUpdated}
           WHERE ${column} = $1`;
      const r = await crm.query(sql, isJsonb ? [from, to] : [from, to]);
      updated += r.rowCount || 0;
    }
  }

  for (const spec of TEXT_COLUMNS) {
    await replaceColumn(spec.table, spec.column);
  }
  for (const spec of JSONB_COLUMNS) {
    await replaceColumn(spec.table, spec.column, true);
  }

  return updated;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const dryRun = !apply;

  const erpStorageRoot = config.erpStorageRoot;
  const crmUploadRoot = config.crmUploadRoot;

  if (!erpStorageRoot) {
    console.error(`
ERP_STORAGE_ROOT is not set.

SQL migration stores ERP file paths only; physical files are copied in this separate step.
Add to migration/.env (Laravel storage/app/public from the ERP server or a local copy):

  ERP_STORAGE_ROOT=C:/path/to/erp/storage/app/public
  CRM_UPLOAD_ROOT=C:/rentfoxxy/crm_rentfoxxy/backend/uploads
`);
    process.exit(1);
  }

  if (!require('fs').existsSync(erpStorageRoot)) {
    console.error(`ERP_STORAGE_ROOT does not exist: ${erpStorageRoot}`);
    process.exit(1);
  }

  writeLog(
    'migration',
    `File sync ${dryRun ? '(dry-run)' : '(apply)'} erp=${erpStorageRoot} crm=${crmUploadRoot}`
  );

  const crm = getCrmPool();
  const schema = await loadSchemaColumns(crm);
  const legacyPaths = await collectLegacyPaths(crm, schema);
  writeLog('migration', `Found ${legacyPaths.length} unique legacy file paths in CRM DB`);

  const mapping = new Map();
  let copied = 0;
  let skippedExisting = 0;
  let missing = 0;

  for (const erpPath of legacyPaths) {
    const crmRel = crmRelativePath(erpPath);
    mapping.set(erpPath, crmRel);

    const src = resolveErpSourceFile(erpStorageRoot, erpPath);
    const dest = destAbsolutePath(crmUploadRoot, crmRel);

    if (!src) {
      missing += 1;
      if (missing <= 20) writeLog('migration', `MISSING ${erpPath}`);
      continue;
    }

    if (dryRun) {
      writeLog('migration', `WOULD COPY ${erpPath} -> ${crmRel}`);
      copied += 1;
      continue;
    }

    const result = copyFileSafe(src, dest);
    if (result.copied) copied += 1;
    if (result.skipped) skippedExisting += 1;
  }

  let dbUpdates = 0;
  if (!dryRun && mapping.size) {
    dbUpdates = await rewriteDbPaths(crm, mapping, schema);
  }

  writeLog(
    'migration',
    `File sync done: unique=${legacyPaths.length} copied=${copied} skipped_existing=${skippedExisting} missing=${missing} db_rows_touched=${dbUpdates}`
  );

  if (missing > 20) {
    writeLog('migration', `... and ${missing - 20} more missing files (not listed)`);
  }

  await closePools();

  if (dryRun) {
    console.log('\nDry run complete. Re-run with --apply to copy files and update DB paths.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
