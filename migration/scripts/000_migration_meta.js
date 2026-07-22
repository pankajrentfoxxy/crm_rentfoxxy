/**
 * 000 — Migration infrastructure tables (erp_id_map, migration_runs)
 */
const { ensureIdMapTable } = require('../lib/id-map');
const { writeLog } = require('../lib/logger');

module.exports = {
  id: '000',
  name: 'migration_meta',
  async run({ crm }) {
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
    await ensureIdMapTable(crm);
    writeLog('migration', 'Migration meta tables ready');
    return 0;
  },
};
