const fs = require('fs');
const path = require('path');
const config = require('./config');
const { getErpPool, getCrmPool, closePools } = require('./db');
const { ensureIdMapTable } = require('./id-map');
const { writeLog } = require('./logger');
const { AUTH_PROTECTED, SYSTEM_PROTECTED } = require('./preserve');

async function ensureMigrationRunsTable(crm) {
  await crm.query(`
    CREATE TABLE IF NOT EXISTS migration_runs (
      module_id     VARCHAR(8)   PRIMARY KEY,
      module_name   VARCHAR(64)  NOT NULL,
      status        VARCHAR(20)  NOT NULL DEFAULT 'pending',
      rows_migrated BIGINT       DEFAULT 0,
      started_at    TIMESTAMPTZ,
      finished_at   TIMESTAMPTZ,
      error_message TEXT
    )
  `);
}

async function getModuleStatus(crm, moduleId) {
  const { rows } = await crm.query(
    'SELECT status FROM migration_runs WHERE module_id = $1',
    [moduleId]
  );
  return rows[0]?.status ?? null;
}

async function markModuleStart(crm, moduleId, moduleName) {
  await crm.query(
    `INSERT INTO migration_runs (module_id, module_name, status, started_at)
     VALUES ($1, $2, 'running', NOW())
     ON CONFLICT (module_id) DO UPDATE
       SET status = 'running', started_at = NOW(), error_message = NULL`,
    [moduleId, moduleName]
  );
}

async function markModuleDone(crm, moduleId, rowsMigrated) {
  await crm.query(
    `UPDATE migration_runs
        SET status = 'completed', rows_migrated = $2, finished_at = NOW()
      WHERE module_id = $1`,
    [moduleId, rowsMigrated]
  );
}

async function markModuleFailed(crm, moduleId, err) {
  await crm.query(
    `UPDATE migration_runs
        SET status = 'failed', error_message = $2, finished_at = NOW()
      WHERE module_id = $1`,
    [moduleId, String(err?.message || err).slice(0, 4000)]
  );
}

/**
 * Run a migration module inside a transaction.
 * Module signature: async ({ erp, crm, batchSize, helpers }) => { rowsMigrated }
 */
async function runModule(moduleDef, { force = false } = {}) {
  const erp = await getErpPool();
  const crm = getCrmPool();
  const client = await crm.connect();

  try {
    const status = await getModuleStatus(client, moduleDef.id);
    if (status === 'completed' && !force) {
      writeLog('migration', `Skipping ${moduleDef.id} ${moduleDef.name} (already completed)`);
      return { skipped: true, rowsMigrated: 0 };
    }

    writeLog('migration', `Migrating ${moduleDef.name}...`);
    if (moduleDef.protectedTargets?.some((t) => [...AUTH_PROTECTED, ...SYSTEM_PROTECTED].includes(t))) {
      throw new Error(`Module ${moduleDef.id} targets protected tables — revise module definition`);
    }
    await markModuleStart(client, moduleDef.id, moduleDef.name);

    await client.query('BEGIN');
    const rowsMigrated = await moduleDef.run({
      erp,
      crm: client,
      batchSize: config.batchSize,
    });
    await client.query('COMMIT');

    await markModuleDone(client, moduleDef.id, rowsMigrated || 0);
    writeLog('migration', `${moduleDef.name}: ${rowsMigrated || 0}/${rowsMigrated || 0} completed`);
    return { skipped: false, rowsMigrated: rowsMigrated || 0 };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) { /* ignore */ }
    await markModuleFailed(client, moduleDef.id, err);
    writeLog('migration', `FAILED ${moduleDef.name}: ${err.message}`);
    throw err;
  } finally {
    client.release();
  }
}

async function initMigrationInfrastructure() {
  const crm = getCrmPool();
  await ensureIdMapTable(crm);
  await ensureMigrationRunsTable(crm);
}

function loadModules() {
  const scriptsDir = path.join(__dirname, '..', 'scripts');
  const files = fs.readdirSync(scriptsDir)
    .filter((f) => /^\d{3}_.+\.js$/.test(f))
    .sort();
  return files.map((f) => {
    const mod = require(path.join(scriptsDir, f));
    if (!mod.id || !mod.name || typeof mod.run !== 'function') {
      throw new Error(`Invalid migration module: ${f}`);
    }
    return mod;
  });
}

module.exports = {
  initMigrationInfrastructure,
  runModule,
  loadModules,
  closePools,
};
