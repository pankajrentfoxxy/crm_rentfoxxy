#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { ErpSqlDumpSource, resolveDumpPath } = require('../lib/erpSqlDumpSource');
const { getCrmPool, closePools } = require('../lib/db');
const { parseJson } = require('../lib/helpers');

function parseJsonArray(raw) {
  const p = parseJson(raw, null);
  if (Array.isArray(p)) return p;
  if (p != null) return [p];
  return [];
}

function erpEligible(dc) {
  const hasJson = (v) => parseJsonArray(v).length > 0;
  return (
    hasJson(dc.rejected_serial_numbers) ||
    hasJson(dc.returned_serial_numbers) ||
    hasJson(dc.pickuped_serial_numbers) ||
    String(dc.status || '').toLowerCase() === 'pending'
  );
}

function erpInBucket(dc, men) {
  const pid = String(dc.delivery_person_id ?? '').trim();
  if (!pid || !/^\d+$/.test(pid) || !men.has(pid) || !erpEligible(dc) || !dc.dc_number) return false;
  return true;
}

async function main() {
  const src = new ErpSqlDumpSource(resolveDumpPath());
  const dcs = src.getTableRows('delivery_challans');
  const dmen = src.getTableRows('delivery_men');
  const men = new Set(dmen.map((m) => String(m.id)));

  const erpBucket = new Set();
  for (const dc of dcs) {
    if (erpInBucket(dc, men)) erpBucket.add(String(dc.dc_number));
  }

  const crm = getCrmPool();
  const crmR = await crm.query(`
    SELECT DISTINCT d.dc_number, d.delivery_person_id, d.status,
           jsonb_array_length(COALESCE(d.rejected_serial_numbers, '[]'::jsonb)) AS rej,
           jsonb_array_length(COALESCE(d.returned_serial_numbers, '[]'::jsonb)) AS ret,
           jsonb_array_length(COALESCE(d.pickuped_serial_numbers, '[]'::jsonb)) AS pic
      FROM delivery_challan_lines d
     INNER JOIN delivery_technicians dt ON dt.technician_id = d.delivery_person_id
     WHERE (
       COALESCE(jsonb_array_length(d.rejected_serial_numbers), 0) > 0
       OR COALESCE(jsonb_array_length(d.returned_serial_numbers), 0) > 0
       OR COALESCE(jsonb_array_length(d.pickuped_serial_numbers), 0) > 0
       OR d.status = 'pending'
     )
  `);

  const crmBucket = new Set(crmR.rows.map((r) => String(r.dc_number)));
  const extra = [...crmBucket].filter((d) => !erpBucket.has(d));
  const missing = [...erpBucket].filter((d) => !crmBucket.has(d));

  console.log('ERP bucket DCs:', erpBucket.size);
  console.log('CRM bucket DCs:', crmBucket.size);
  console.log('Missing in CRM:', missing.length, missing);
  console.log('Extra in CRM:', extra.length);

  // Sample extra DCs - compare ERP vs CRM
  const erpByDc = new Map();
  for (const dc of dcs) {
    const k = String(dc.dc_number);
    if (!erpByDc.has(k)) erpByDc.set(k, []);
    erpByDc.get(k).push(dc);
  }

  const reasons = { erp_not_eligible: 0, erp_invalid_person: 0, erp_valid_not_in_bucket: 0, crm_only_pending: 0, crm_stale_json: 0 };

  for (const dcNum of extra.slice(0, 50)) {
    const erpRows = erpByDc.get(dcNum) || [];
    const crmRows = crmR.rows.filter((r) => String(r.dc_number) === dcNum);

    const anyErpEligible = erpRows.some(erpEligible);
    const anyErpInBucket = erpRows.some((r) => erpInBucket(r, men));

    if (!erpRows.length) {
      console.log(dcNum, 'NOT IN ERP AT ALL');
      continue;
    }
    if (!anyErpEligible) reasons.erp_not_eligible += 1;
    else if (!anyErpInBucket) {
      const sample = erpRows[0];
      const pid = String(sample.delivery_person_id ?? '');
      if (!pid || !/^\d+$/.test(pid) || !men.has(pid)) reasons.erp_invalid_person += 1;
      else reasons.erp_valid_not_in_bucket += 1;
    }

    const crmPending = crmRows.some((r) => r.status === 'pending');
    if (crmPending) reasons.crm_only_pending += 1;
  }

  console.log('\nExtra breakdown (first 50):', reasons);

  // Count why extras exist across ALL extra
  const allReasons = { no_erp_row: 0, erp_not_eligible: 0, erp_invalid_person: 0, erp_would_be_in_bucket: 0 };
  for (const dcNum of extra) {
    const erpRows = erpByDc.get(dcNum) || [];
    if (!erpRows.length) { allReasons.no_erp_row += 1; continue; }
    if (!erpRows.some(erpEligible)) { allReasons.erp_not_eligible += 1; continue; }
    if (!erpRows.some((r) => erpInBucket(r, men))) {
      const sample = erpRows.find(erpEligible) || erpRows[0];
      const pid = String(sample.delivery_person_id ?? '').trim();
      if (!pid || !/^\d+$/.test(pid) || !men.has(pid)) allReasons.erp_invalid_person += 1;
      else allReasons.erp_would_be_in_bucket += 1;
    }
  }
  console.log('\nAll extra reasons:', allReasons);

  // CRM rows eligible but ERP delivery_person_id null - should clear person or exclude
  const pendingOnly = await crm.query(`
    SELECT COUNT(DISTINCT d.dc_number) c FROM delivery_challan_lines d
     INNER JOIN delivery_technicians dt ON dt.technician_id = d.delivery_person_id
     WHERE d.status = 'pending'
       AND COALESCE(jsonb_array_length(d.rejected_serial_numbers), 0) = 0
       AND COALESCE(jsonb_array_length(d.returned_serial_numbers), 0) = 0
       AND COALESCE(jsonb_array_length(d.pickuped_serial_numbers), 0) = 0
  `);
  console.log('\nCRM pending-only bucket rows:', pendingOnly.rows[0].c);

  await closePools();
  src.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
