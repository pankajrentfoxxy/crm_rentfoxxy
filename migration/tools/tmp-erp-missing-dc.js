const { ErpSqlDumpSource, resolveDumpPath } = require('../lib/erpSqlDumpSource');
const src = new ErpSqlDumpSource(resolveDumpPath());
const dcs = src.getTableRows('delivery_challans');
const bad = dcs.filter((r) => r.delivery_person_id && !/^\d+$/.test(String(r.delivery_person_id)));
console.log('ERP non-numeric delivery_person_id', bad.length);
if (bad[0]) console.log(bad[0].id, bad[0].dc_number, bad[0].delivery_person_id);
const missing = ['DC-003323','DC-003579','DC/26-27/0464'];
for (const n of missing) {
  const rows = dcs.filter((r) => String(r.dc_number) === n);
  console.log('\n', n, rows.map((r) => ({
    id: r.id,
    delivery_person_id: r.delivery_person_id,
    status: r.status,
  })));
}
