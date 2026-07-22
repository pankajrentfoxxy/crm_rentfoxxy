require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getCrmPool, getErpPool, closePools } = require('../lib/db');

(async () => {
  const crm = getCrmPool();
  const erp = await getErpPool();

  const [erpRows] = await erp.query(
    `SELECT COUNT(*) AS c FROM serial_numbers WHERE status2 = 'replace' OR status = 'replace'`
  );
  console.log('ERP replace serials:', erpRows[0].c);

  const crmReplace = await crm.query(
    `SELECT COUNT(*)::int AS c FROM vendor_serial_numbers
      WHERE deleted_at IS NULL
        AND (
          inventory_status = 'replace'
          OR extra->>'status2' = 'replace'
          OR extra->>'inventory_status' = 'replace'
        )`
  );
  console.log('CRM replace serials (list query):', crmReplace.rows[0].c);

  const crmInRepair = await crm.query(
    `SELECT COUNT(*)::int AS c FROM vendor_serial_numbers
      WHERE deleted_at IS NULL AND inventory_status = 'in_repair'
        AND (extra->>'status2' = 'replace' OR extra->>'erp_status' = 'replace')`
  );
  console.log('CRM in_repair with erp replace hint:', crmInRepair.rows[0].c);

  const apiSql = `(
    s.inventory_status = 'replace'
    OR (
      (s.inventory_status IS NULL OR TRIM(COALESCE(s.inventory_status, '')) = '')
      AND (
        COALESCE(NULLIF(TRIM(s.extra->>'inventory_status'), ''), '') = 'replace'
        OR COALESCE(NULLIF(TRIM(s.extra->>'status2'), ''), '') = 'replace'
      )
    )
  )`;

  const apiCount = await crm.query(
    `SELECT COUNT(*)::int AS c FROM vendor_serial_numbers s
      WHERE s.deleted_at IS NULL AND s.po_id IS NOT NULL AND ${apiSql}`
  );
  console.log('CRM replace serials (actual API filter):', apiCount.rows[0].c);

  const missing = await crm.query(
    `SELECT serial_id, serial_number, inventory_status, extra->>'status2' AS status2, po_id
       FROM vendor_serial_numbers s
      WHERE s.deleted_at IS NULL AND extra->>'status2' = 'replace'
        AND NOT (${apiSql})`
  );
  console.log('Rows with status2=replace but excluded by API filter:', missing.rows.length);
  if (missing.rows.length) console.log(missing.rows);

  await closePools();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
