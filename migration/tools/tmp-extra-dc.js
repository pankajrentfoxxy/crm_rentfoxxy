const { ErpSqlDumpSource, resolveDumpPath } = require('../lib/erpSqlDumpSource');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getCrmPool, closePools } = require('../lib/db');

(async () => {
  const erp = new ErpSqlDumpSource(resolveDumpPath());
  const c = getCrmPool();
  for (const dc of ['DC-000011', 'DC-000855', 'DC-003323']) {
    const erpRows = erp.getTableRows('delivery_challans').filter((r) => r.dc_number === dc);
    const crm = await c.query(
      `SELECT id, dc_number, delivery_person_id, status FROM delivery_challan_lines WHERE dc_number = $1`,
      [dc]
    );
    console.log('\n', dc);
    console.log(' ERP:', erpRows.map((r) => ({ id: r.id, pid: r.delivery_person_id, status: r.status })));
    console.log(' CRM:', crm.rows);
  }
  await closePools();
})();
