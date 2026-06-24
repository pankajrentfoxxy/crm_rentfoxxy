require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getCrmPool, getErpPool, closePools } = require('../lib/db');

(async () => {
  const crm = getCrmPool();
  const erp = await getErpPool();

  const [erpRows] = await erp.query('SELECT COUNT(*) AS c FROM rent_reports');
  console.log('ERP rent_reports:', erpRows[0].c);

  const crmBills = await crm.query('SELECT COUNT(*)::int AS c FROM vendor_monthly_bills');
  console.log('CRM vendor_monthly_bills:', crmBills.rows[0].c);

  const sample = await crm.query(
    `SELECT vb.bill_id, vb.bill_number, vb.bill_month, vb.bill_year, vb.status, vb.total_payable,
            COALESCE(v.business_name, v.first_name) AS vendor_name
       FROM vendor_monthly_bills vb
       LEFT JOIN vendors v ON v.vendor_id = vb.vendor_id
      ORDER BY vb.bill_id DESC
      LIMIT 5`
  );
  console.log('Sample CRM bills:', sample.rows);

  await closePools();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
