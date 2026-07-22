require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getCrmPool, closePools } = require('../lib/db');
const { ErpSqlDumpSource, resolveDumpPath } = require('../lib/erpSqlDumpSource');

(async () => {
  const c = getCrmPool();
  const erpMen = new Set(
    new ErpSqlDumpSource(resolveDumpPath()).getTableRows('delivery_men').map((m) => Number(m.id))
  );

  const r = await c.query(`
    SELECT DISTINCT d.dc_number, d.delivery_person_id
    FROM delivery_challan_lines d
    WHERE COALESCE(d.movement_type, 'outbound') = 'outbound'
      AND d.delivery_person_id IS NOT NULL
      AND (
        COALESCE(jsonb_array_length(d.rejected_serial_numbers), 0) > 0
        OR COALESCE(jsonb_array_length(d.returned_serial_numbers), 0) > 0
        OR COALESCE(jsonb_array_length(d.pickuped_serial_numbers), 0) > 0
        OR d.status = 'pending'
      )
  `);

  const valid = r.rows.filter((row) => erpMen.has(Number(row.delivery_person_id)));
  const invalid = r.rows.filter((row) => !erpMen.has(Number(row.delivery_person_id)));
  console.log('CRM bucket DCs (current filter):', r.rows.length);
  console.log('With valid ERP delivery_man id:', new Set(valid.map((x) => x.dc_number)).size);
  console.log('Invalid person id distinct DCs:', new Set(invalid.map((x) => x.dc_number)).size);
  console.log('Invalid person ids sample:', [...new Set(invalid.map((x) => x.delivery_person_id))].slice(0, 15));

  // After remap to crm technician_id
  const maps = await c.query(`SELECT erp_id, crm_id FROM erp_id_map WHERE entity = 'delivery_men'`);
  const erpToCrm = new Map(maps.rows.map((m) => [Number(m.erp_id), Number(m.crm_id)]));

  const svcIds = await c.query(`SELECT technician_id, user_id FROM delivery_technicians`);
  const allowed = new Set();
  for (const t of svcIds.rows) {
    allowed.add(Number(t.technician_id));
    if (t.user_id) allowed.add(Number(t.user_id));
  }

  const svcMatch = valid.filter((row) => allowed.has(Number(row.delivery_person_id)));
  const needRemap = valid.filter((row) => !allowed.has(Number(row.delivery_person_id)));
  console.log('Valid ERP ids matching CRM technician_id directly:', new Set(svcMatch.map((x) => x.dc_number)).size);
  console.log('Valid ERP ids NOT in CRM technician set (need remap):', new Set(needRemap.map((x) => x.dc_number)).size);

  await closePools();
})();
