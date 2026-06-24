const { ErpSqlDumpSource, resolveDumpPath } = require('../lib/erpSqlDumpSource');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getCrmPool, closePools } = require('../lib/db');

(async () => {
  const erp = new ErpSqlDumpSource(resolveDumpPath());
  const crm = getCrmPool();
  const ct = erp.getTableRows('complaints_ticket');
  const pods = erp.getTableRows('pod_submissions');
  const podByPickup = new Map(pods.map((p) => [Number(p.pickup_id), p]));

  const withRdc = ct.filter((r) => r.return_dc_number && String(r.return_dc_number).trim());
  const viewFilter = ct.filter((r) => {
    const ps = podByPickup.get(Number(r.id));
    return ps?.pod_closed_at && String(r.complaint_status || r.status).toLowerCase() === 'close'
      && String(r.complaint_type).toLowerCase() === 'pickup';
  });
  console.log('ERP return_dc_number not null', withRdc.length);
  console.log('ERP view filter (close pickup + pod)', viewFilter.length);

  const crmRows = await crm.query("SELECT COUNT(*)::int c FROM delivery_challan_lines WHERE movement_type='return'");
  const crmDistinct = await crm.query("SELECT COUNT(DISTINCT dc_number)::int c FROM delivery_challan_lines WHERE movement_type='return'");
  const crmMap = await crm.query("SELECT COUNT(*)::int c FROM erp_id_map WHERE entity='return_delivery_challans'");
  console.log('CRM return lines', crmRows.rows[0].c, 'distinct', crmDistinct.rows[0].c, 'mapped', crmMap.rows[0].c);

  const drPending = await crm.query("SELECT COUNT(DISTINCT dc_number)::int c FROM delivery_challan_lines WHERE COALESCE(movement_type,'outbound')='outbound' AND status='pending'");
  const drPendingRows = await crm.query("SELECT COUNT(*)::int c FROM delivery_challan_lines WHERE COALESCE(movement_type,'outbound')='outbound' AND status='pending'");
  const drDel = await crm.query("SELECT COUNT(DISTINCT dc_number)::int c FROM delivery_challan_lines WHERE COALESCE(movement_type,'outbound')='outbound' AND status='delivered'");
  console.log('CRM DR pending distinct/rows', drPending.rows[0].c, drPendingRows.rows[0].c);
  console.log('CRM DR delivered distinct', drDel.rows[0].c);

  const dcDistinct = await crm.query("SELECT COUNT(DISTINCT dc_number)::int c FROM delivery_challan_lines WHERE COALESCE(movement_type,'outbound')='outbound'");
  const dcRows = await crm.query("SELECT COUNT(*)::int c FROM delivery_challan_lines WHERE COALESCE(movement_type,'outbound')='outbound'");
  console.log('CRM DC distinct/rows', dcDistinct.rows[0].c, dcRows.rows[0].c);

  await closePools();
})();
