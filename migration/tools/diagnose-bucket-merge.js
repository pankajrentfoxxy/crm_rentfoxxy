#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { ErpSqlDumpSource, resolveDumpPath } = require('../lib/erpSqlDumpSource');
const { getCrmPool, closePools } = require('../lib/db');
const { parseJson, getCrmId } = require('../lib/helpers');

function arrLen(raw) {
  const p = parseJson(raw, null);
  return Array.isArray(p) ? p.length : 0;
}

async function main() {
  const src = new ErpSqlDumpSource(resolveDumpPath());
  const dcs = src.getTableRows('delivery_challans');
  const crm = getCrmPool();

  let crmPickupFromOldOnly = 0;
  let crmRejectedFromOld = 0;

  for (const erp of dcs) {
    const crmLineId = await getCrmId(crm, 'delivery_challans', erp.id);
    if (!crmLineId) continue;

    const erpPic = arrLen(erp.pickuped_serial_numbers);
    const erpOldPic = arrLen(erp.old_pickuped_serial_numbers);
    const erpRej = arrLen(erp.rejected_serial_numbers);
    const erpOldRej = arrLen(erp.old_rejected_serial_numbers);

    const erpEligible =
      erpRej > 0 || arrLen(erp.returned_serial_numbers) > 0 || erpPic > 0 ||
      String(erp.status).toLowerCase() === 'pending';

    const erpEligibleStrict = erpEligible; // same as controller

    const mergedPicEligible = erpPic > 0 || erpOldPic > 0;
    if (!erpEligible && mergedPicEligible) crmPickupFromOldOnly += 1;
    if (erpRej === 0 && arrLen(erp.old_rejected_serial_numbers) > 0 && !erpEligible) crmRejectedFromOld += 1;

    const { rows } = await crm.query(
      `SELECT jsonb_array_length(COALESCE(pickuped_serial_numbers,'[]'::jsonb)) pic,
              jsonb_array_length(COALESCE(rejected_serial_numbers,'[]'::jsonb)) rej,
              status
         FROM delivery_challan_lines WHERE id = $1`,
      [crmLineId]
    );
    const c = rows[0];
    const crmEligible =
      Number(c.rej) > 0 || Number(c.pic) > 0 ||
      c.status === 'pending' ||
      false;

    if (Number(c.pic) > 0 && erpPic === 0 && erpOldPic > 0) {
      // merged old into pickup caused CRM-only eligibility
    }
  }

  // Count lines where CRM eligible due to merged pickup (erp pickup empty, old pickup has data)
  let extraFromMergePickup = 0;
  let extraFromMergeReject = 0;
  for (const erp of dcs) {
    const crmLineId = await getCrmId(crm, 'delivery_challans', erp.id);
    if (!crmLineId) continue;
    const erpPic = arrLen(erp.pickuped_serial_numbers);
    const erpOldPic = arrLen(erp.old_pickuped_serial_numbers);
    const erpRej = arrLen(erp.rejected_serial_numbers);
    const erpRet = arrLen(erp.returned_serial_numbers);
    const erpEligible =
      erpRej > 0 || erpRet > 0 || erpPic > 0 || String(erp.status).toLowerCase() === 'pending';

    const { rows } = await crm.query(
      `SELECT jsonb_array_length(COALESCE(pickuped_serial_numbers,'[]'::jsonb)) pic,
              jsonb_array_length(COALESCE(rejected_serial_numbers,'[]'::jsonb)) rej,
              jsonb_array_length(COALESCE(returned_serial_numbers,'[]'::jsonb)) ret,
              status FROM delivery_challan_lines WHERE id = $1`,
      [crmLineId]
    );
    const c = rows[0];
    const crmEligible =
      Number(c.rej) > 0 || Number(c.ret) > 0 || Number(c.pic) > 0 || c.status === 'pending';
    if (crmEligible && !erpEligible) {
      if (erpPic === 0 && erpOldPic > 0 && Number(c.pic) > 0) extraFromMergePickup += 1;
      if (erpRej === 0 && arrLen(erp.old_rejected_serial_numbers) > 0 && Number(c.rej) > 0) extraFromMergeReject += 1;
    }
  }

  console.log('CRM eligible only because 038 merged old_pickup into pickuped:', extraFromMergePickup);
  console.log('CRM eligible only because 038 merged old_rejected into rejected:', extraFromMergeReject);

  await closePools();
  src.end();
}

main().catch(console.error);
