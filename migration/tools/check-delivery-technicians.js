require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getCrmPool, getErpPool, closePools } = require('../lib/db');

(async () => {
  const crm = getCrmPool();
  const erp = await getErpPool();

  const [erpRows] = await erp.query('SELECT COUNT(*) AS c FROM delivery_men');
  console.log('ERP delivery_men:', erpRows[0].c);

  const crmRows = await crm.query('SELECT COUNT(*)::int AS c FROM delivery_technicians');
  console.log('CRM delivery_technicians:', crmRows.rows[0].c);

  const sample = await crm.query(
    `SELECT technician_id, first_name, last_name, phone, email, is_active
       FROM delivery_technicians ORDER BY technician_id LIMIT 5`
  );
  console.log('Sample:', sample.rows);

  await closePools();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
