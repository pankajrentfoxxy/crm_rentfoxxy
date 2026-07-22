#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getCrmPool, closePools } = require('../lib/db');
const { createErpSource } = require('../lib/erpSource');

const EFFECTIVE = `COALESCE(NULLIF(TRIM(s.qc_status), ''), NULLIF(TRIM(s.extra->>'status'), ''), 'pending')`;

(async () => {
  const erp = await createErpSource();
  const crm = getCrmPool();
  const [erpPassed] = await erp.query("SELECT id FROM `serial_numbers` WHERE status = 'passed'");
  const erpPassedIds = new Set(erpPassed.map((r) => Number(r.id)));

  const { rows } = await crm.query(`
    SELECT s.serial_id, s.serial_number, s.qc_status, s.extra->>'status' AS extra_status,
           s.extra->>'erp_serial_id' AS erp_id, s.inventory_status, m.erp_id AS map_erp_id
      FROM vendor_serial_numbers s
      INNER JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
      LEFT JOIN erp_id_map m ON m.entity = 'serial_numbers' AND m.crm_id = s.serial_id
     WHERE s.deleted_at IS NULL AND s.po_id IS NOT NULL AND ${EFFECTIVE} = 'passed'
  `);

  const extras = rows.filter((r) => {
    const eid = Number(r.map_erp_id || r.erp_id || 0);
    return !eid || !erpPassedIds.has(eid);
  });

  console.log('CRM passed extras not in ERP passed:', extras.length);
  for (const r of extras) {
    console.log(r);
    const eid = Number(r.map_erp_id || r.erp_id);
    if (eid) {
      const [erpRow] = await erp.query('SELECT id, status, serial_number FROM `serial_numbers` WHERE id = ?', [eid]);
      console.log('  ERP:', erpRow[0]);
    }
  }

  await erp.close?.();
  await closePools();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
