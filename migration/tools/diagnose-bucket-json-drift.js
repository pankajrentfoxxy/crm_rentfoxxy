#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { ErpSqlDumpSource, resolveDumpPath } = require('../lib/erpSqlDumpSource');
const { getCrmPool, closePools } = require('../lib/db');
const { parseJson, getCrmId } = require('../lib/helpers');

function arrLen(raw) {
  const p = parseJson(raw, null);
  return Array.isArray(p) ? p.length : p != null ? 1 : 0;
}

async function main() {
  const src = new ErpSqlDumpSource(resolveDumpPath());
  const dcs = src.getTableRows('delivery_challans');
  const crm = getCrmPool();

  let crmHasJsonErpEmpty = 0;
  let statusMismatchPending = 0;
  let synced = 0;

  for (const erp of dcs.slice(0, 500)) {
    const crmLineId = await getCrmId(crm, 'delivery_challans', erp.id);
    if (!crmLineId) continue;
    synced += 1;
    const { rows } = await crm.query(
      `SELECT status, rejected_serial_numbers, returned_serial_numbers, pickuped_serial_numbers
         FROM delivery_challan_lines WHERE id = $1`,
      [crmLineId]
    );
    if (!rows.length) continue;
    const c = rows[0];
    const erpRej = arrLen(erp.rejected_serial_numbers);
    const erpRet = arrLen(erp.returned_serial_numbers);
    const erpPic = arrLen(erp.pickuped_serial_numbers);
    const crmRej = Number(c.rejected_serial_numbers?.length ?? 0);
    const crmRet = Number(c.returned_serial_numbers?.length ?? 0);
    const crmPic = Number(c.pickuped_serial_numbers?.length ?? 0);

    if ((crmRej > 0 && erpRej === 0) || (crmRet > 0 && erpRet === 0) || (crmPic > 0 && erpPic === 0)) {
      crmHasJsonErpEmpty += 1;
    }
    if (c.status === 'pending' && String(erp.status).toLowerCase() !== 'pending') {
      statusMismatchPending += 1;
    }
  }

  console.log('Sample 500 ERP rows mapped:', synced);
  console.log('CRM has bucket JSON but ERP empty:', crmHasJsonErpEmpty);

  // Full count estimate
  let totalDrift = 0;
  for (const erp of dcs) {
    const crmLineId = await getCrmId(crm, 'delivery_challans', erp.id);
    if (!crmLineId) continue;
    const { rows } = await crm.query(
      `SELECT rejected_serial_numbers, returned_serial_numbers, pickuped_serial_numbers, status
         FROM delivery_challan_lines WHERE id = $1`,
      [crmLineId]
    );
    if (!rows.length) continue;
    const c = rows[0];
    const crmEligible =
      (c.rejected_serial_numbers?.length ?? 0) > 0 ||
      (c.returned_serial_numbers?.length ?? 0) > 0 ||
      (c.pickuped_serial_numbers?.length ?? 0) > 0 ||
      c.status === 'pending';
    const erpEligible =
      arrLen(erp.rejected_serial_numbers) > 0 ||
      arrLen(erp.returned_serial_numbers) > 0 ||
      arrLen(erp.pickuped_serial_numbers) > 0 ||
      String(erp.status).toLowerCase() === 'pending';
    if (crmEligible && !erpEligible) totalDrift += 1;
  }
  console.log('Lines CRM-eligible but ERP-not-eligible:', totalDrift);

  await closePools();
  src.end();
}

main().catch(console.error);
