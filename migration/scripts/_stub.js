/**
 * Template for module migrations.
 * Full implementation pending PRE_MIGRATION_REVIEW.md sign-off.
 */
const { progress } = require('../lib/logger');
const { assertSafeSql } = require('../lib/preserve');

function createStubModule(id, name, erpTables, crmTables) {
  return {
    id,
    name,
    erpTables,
    crmTables,
    async run({ erp, crm, batchSize }) {
      assertSafeSql(`SELECT 1`, name);
      for (const tbl of erpTables) {
        const [rows] = await erp.query(`SELECT COUNT(*) AS cnt FROM \`${tbl}\``);
        progress(`${name} (ERP ${tbl} count)`, rows[0].cnt, rows[0].cnt);
      }
      throw new Error(
        `Module ${id} ${name} is not implemented yet. ` +
        'Business-data only — auth/RBAC/config preserved per AUTH_TABLES.md and SYSTEM_TABLES.md.'
      );
    },
  };
}

module.exports = { createStubModule };
