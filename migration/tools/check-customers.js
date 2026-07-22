require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getCrmPool, getErpPool, closePools } = require('../lib/db');

(async () => {
  const crm = getCrmPool();
  const erp = await getErpPool();

  const erpCount = (await erp.query('SELECT COUNT(*) AS cnt FROM `customers`'))[0][0].cnt;
  const crmTotal = (await crm.query('SELECT COUNT(*)::int c FROM customers')).rows[0].c;
  const crmMapped = (
    await crm.query(`SELECT COUNT(*)::int c FROM erp_id_map WHERE entity = 'customers'`)
  ).rows[0].c;
  const crmExisting = (
    await crm.query(`SELECT COUNT(*)::int c FROM customers WHERE type = 'Existing'`)
  ).rows[0].c;
  const crmByStatus = (
    await crm.query(`SELECT status, COUNT(*)::int c FROM customers GROUP BY status ORDER BY status`)
  ).rows;
  const crmActive = (
    await crm.query(`SELECT COUNT(*)::int c FROM customers WHERE status = 1`)
  ).rows[0].c;
  let mod007 = [];
  try {
    mod007 = (
      await crm.query(`SELECT status, completed_at FROM migration_modules WHERE module_id = '007'`)
    ).rows;
  } catch {
    mod007 = (await crm.query(`SELECT module_id, status FROM migration_runs ORDER BY started_at DESC LIMIT 5`)).rows;
  }

  console.log('ERP customers:', erpCount);
  console.log('CRM customers total:', crmTotal);
  console.log('CRM erp_id_map (customers):', crmMapped);
  console.log('CRM type=Existing:', crmExisting);
  console.log('CRM by status:', crmByStatus);
  console.log('CRM status=1 (visible in UI):', crmActive);
  console.log('Migration module 007:', mod007);

  const sample = (
    await crm.query(`SELECT customer_id, name, email, type, status FROM customers ORDER BY customer_id LIMIT 30`)
  ).rows;
  console.log('CRM sample rows:', sample.length);
  console.log(sample);

  await closePools();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
