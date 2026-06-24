/**
 * Run refurb → CRM migration modules (PostgreSQL source, not ERP MySQL).
 */
const config = require('./config');
const { createRefurbSource } = require('./refurbSource');
const { getCrmPool, closePools } = require('./db');
const { ensureIdMapTable } = require('./id-map');
const { writeLog } = require('./logger');
const {
  ensureMigrationRunsTable,
  getModuleStatus,
  markModuleStart,
  markModuleDone,
  markModuleFailed,
} = require('./runner');

async function runRefurbModule(moduleDef, { force = false } = {}) {
  const source = await createRefurbSource();
  const crm = getCrmPool();
  const client = await crm.connect();

  try {
    const status = await getModuleStatus(client, moduleDef.id);
    if (status === 'completed' && !force) {
      writeLog('migration', `Skipping ${moduleDef.id} ${moduleDef.name} (already completed)`);
      return { skipped: true, rowsMigrated: 0 };
    }

    writeLog('migration', `Migrating ${moduleDef.name} from ${source.database}...`);
    await markModuleStart(client, moduleDef.id, moduleDef.name);

    await client.query('BEGIN');
    const rowsMigrated = await moduleDef.run({
      source,
      crm: client,
      batchSize: config.batchSize,
    });
    await client.query('COMMIT');

    await markModuleDone(client, moduleDef.id, rowsMigrated || 0);
    return { skipped: false, rowsMigrated: rowsMigrated || 0 };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    await markModuleFailed(client, moduleDef.id, err);
    writeLog('migration', `FAILED ${moduleDef.name}: ${err.message}`);
    throw err;
  } finally {
    client.release();
    if (source?.close) await source.close().catch(() => {});
  }
}

async function initRefurbMigrationInfrastructure() {
  const crm = getCrmPool();
  await ensureIdMapTable(crm);
  await ensureMigrationRunsTable(crm);
}

module.exports = {
  initRefurbMigrationInfrastructure,
  runRefurbModule,
  closePools,
};
