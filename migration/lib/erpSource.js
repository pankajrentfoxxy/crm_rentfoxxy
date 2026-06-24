const fs = require('fs');
const { getErpPool } = require('./db');
const { ErpSqlDumpSource, resolveDumpPath } = require('./erpSqlDumpSource');
const { writeLog } = require('./logger');

function dumpSourceFromPath(dumpPath) {
  const src = new ErpSqlDumpSource(dumpPath);
  return {
    mode: 'sql_dump',
    dumpPath: src.filePath,
    query: (sql, params) => src.query(sql, params),
    getTableRows: (table) => src.getTableRows(table),
    close: () => src.end(),
  };
}

/**
 * Unified ERP source: live MySQL (ERP_MYSQL_*) or SQL dump (ERP_SQL_DUMP_PATH).
 * Auto-falls back to erp_rentfoxxy_db.sql when MySQL is unreachable (local dev).
 */
async function createErpSource() {
  const explicitDump = process.env.ERP_SQL_DUMP_PATH
    || (process.env.ERP_USE_SQL_DUMP === 'true' ? resolveDumpPath() : null);

  if (explicitDump && fs.existsSync(explicitDump)) {
    return dumpSourceFromPath(explicitDump);
  }

  const defaultDump = resolveDumpPath();
  const autoFallback = process.env.ERP_MYSQL_AUTO_DUMP !== 'false';

  try {
    const pool = await getErpPool();
    await pool.query('SELECT 1');
    return {
      mode: 'mysql',
      query: (sql, params) => pool.query(sql, params),
      getTableRows: null,
      close: async () => pool.end(),
    };
  } catch (err) {
    const refused = ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET'].includes(err.code);
    if (autoFallback && refused && fs.existsSync(defaultDump)) {
      writeLog(
        'migration',
        `MySQL unavailable (${err.code}) — using SQL dump: ${defaultDump}`
      );
      console.warn(`MySQL unavailable (${err.message}). Using SQL dump: ${defaultDump}`);
      return dumpSourceFromPath(defaultDump);
    }
    throw err;
  }
}

module.exports = { createErpSource };
