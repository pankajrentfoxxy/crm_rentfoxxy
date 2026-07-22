require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getCrmPool, getErpPool, closePools } = require('../lib/db');

(async () => {
  const crm = getCrmPool();
  const erp = await getErpPool();

  const erpTotal = (await erp.query('SELECT COUNT(*) AS cnt FROM `sellers`'))[0][0].cnt;
  const crmTotal = (await crm.query('SELECT COUNT(*)::int c FROM vendors')).rows[0].c;
  const mapped = (
    await crm.query(`SELECT COUNT(*)::int c FROM erp_id_map WHERE entity = 'vendors'`)
  ).rows[0].c;
  const inserted = mapped - (
    await crm.query(
      `SELECT COUNT(*)::int c FROM erp_id_map m
        JOIN vendors v ON v.vendor_id = m.crm_id
        WHERE m.entity = 'vendors' AND v.created_at < (SELECT MIN(started_at) FROM migration_runs WHERE module_id = '006')`
    )
  ).rows[0].c;

  console.log('ERP sellers (vendors):', erpTotal);
  console.log('CRM vendors total:', crmTotal);
  console.log('erp_id_map vendors:', mapped);

  const dupes = (
    await crm.query(
      `SELECT m.erp_id, m.crm_id, v.business_name, v.email, v.gst_number
         FROM erp_id_map m
         JOIN vendors v ON v.vendor_id = m.crm_id
        WHERE m.entity = 'vendors'
        ORDER BY m.crm_id, m.erp_id`
    )
  ).rows;

  const byCrm = {};
  for (const r of dupes) {
    if (!byCrm[r.crm_id]) byCrm[r.crm_id] = [];
    byCrm[r.crm_id].push(r);
  }
  const merged = Object.values(byCrm).filter((g) => g.length > 1);
  console.log('\nERP vendors mapped to same CRM vendor (dedupe):', merged.length, 'groups');
  for (const g of merged) {
    console.log(`  CRM vendor_id=${g[0].crm_id} ${g[0].business_name}`);
    console.log(`    ERP ids: ${g.map((x) => x.erp_id).join(', ')}`);
    console.log(`    GST: ${g[0].gst_number || '—'}  email: ${g[0].email || '—'}`);
  }

  const unmappedErp = (
    await erp.query(
      `SELECT s.id, s.name, s.email, s.gst_number
         FROM sellers s
         LEFT JOIN (
           SELECT erp_id FROM erp_id_map WHERE entity = 'vendors'
         ) m ON m.erp_id = s.id
        WHERE m.erp_id IS NULL
        ORDER BY s.id`
    )
  )[0];
  console.log('\nERP sellers NOT in erp_id_map:', unmappedErp.length);
  if (unmappedErp.length) console.log(unmappedErp);

  await closePools();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
