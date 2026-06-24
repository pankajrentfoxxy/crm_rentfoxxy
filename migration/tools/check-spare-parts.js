require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getCrmPool, getErpPool, closePools } = require('../lib/db');

(async () => {
  const crm = getCrmPool();
  const erp = await getErpPool();
  const erpSpo = (await erp.query('SELECT COUNT(*) AS cnt FROM spare_parts_po'))[0][0].cnt;
  const erpParts = (await erp.query('SELECT COUNT(*) AS cnt FROM spare_parts'))[0][0].cnt;
  const erpSnp = (await erp.query('SELECT COUNT(*) AS cnt FROM serial_number_parts'))[0][0].cnt;
  for (const table of [
    'vendor_spare_parts_purchase_orders',
    'vendor_spare_parts_catalog',
    'spare_parts',
  ]) {
    try {
      const r = await crm.query(`SELECT COUNT(*)::int c FROM ${table}`);
      console.log(`CRM ${table}:`, r.rows[0].c);
    } catch (e) {
      console.log(`CRM ${table}:`, e.message);
    }
  }
  const spareSerials = await crm.query(
    `SELECT COUNT(*)::int c FROM vendor_serial_numbers WHERE spo_id IS NOT NULL AND deleted_at IS NULL`
  );
  console.log('CRM vendor_serial_numbers with spo_id:', spareSerials.rows[0].c);
  console.log('ERP spare_parts_po:', erpSpo);
  console.log('ERP spare_parts catalog:', erpParts);
  console.log('ERP serial_number_parts:', erpSnp);
  await closePools();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
