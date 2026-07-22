#!/usr/bin/env node
/**
 * Compare ERP TechniciansBucketListController logic vs CRM service logic on SQL dump.
 */
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

function erpControllerAssets(dcs, deliveryMenIds, technicianId = 'all') {
  const men = new Set(deliveryMenIds.map(String));
  const byDc = new Map();

  for (const dc of dcs) {
    const pid = String(dc.delivery_person_id ?? '').trim();
    if (!pid || !/^\d+$/.test(pid)) continue;
    if (!men.has(pid)) continue;
    if (technicianId !== 'all' && pid !== String(technicianId)) continue;

    const hasJson = (v) => parseJsonArray(v).length > 0;
    const eligible =
      hasJson(dc.rejected_serial_numbers) ||
      hasJson(dc.returned_serial_numbers) ||
      hasJson(dc.pickuped_serial_numbers) ||
      String(dc.status || '').toLowerCase() === 'pending';
    if (!eligible || !dc.dc_number) continue;

    if (!byDc.has(dc.dc_number)) byDc.set(dc.dc_number, dc);
  }
  return byDc.size;
}

async function crmCurrentLogic(crm, technicianId = 'all') {
  let personIds;
  if (technicianId === 'all' || !technicianId) {
    const r = await crm.query(`SELECT technician_id, user_id FROM delivery_technicians`);
    personIds = new Set();
    for (const row of r.rows) {
      personIds.add(Number(row.technician_id));
      if (row.user_id) personIds.add(Number(row.user_id));
    }
    personIds = [...personIds];
  } else {
    const r = await crm.query(
      `SELECT technician_id, user_id FROM delivery_technicians WHERE technician_id = $1`,
      [Number(technicianId)]
    );
    if (!r.rows.length) return 0;
    personIds = [Number(r.rows[0].technician_id)];
    if (r.rows[0].user_id) personIds.push(Number(r.rows[0].user_id));
  }

  const r = await crm.query(
    `SELECT DISTINCT d.dc_number
       FROM delivery_challan_lines d
      WHERE d.delivery_person_id = ANY($1::int[])
        AND COALESCE(d.movement_type, 'outbound') = 'outbound'
        AND (
          COALESCE(jsonb_array_length(d.rejected_serial_numbers), 0) > 0
          OR COALESCE(jsonb_array_length(d.returned_serial_numbers), 0) > 0
          OR COALESCE(jsonb_array_length(d.pickuped_serial_numbers), 0) > 0
          OR d.status = 'pending'
        )`,
    [personIds]
  );
  return r.rows.length;
}

async function crmErpParityLogic(crm, technicianId = 'all') {
  let techIds;
  if (technicianId === 'all' || !technicianId) {
    const r = await crm.query(`SELECT technician_id FROM delivery_technicians`);
    techIds = r.rows.map((x) => Number(x.technician_id));
  } else {
    techIds = [Number(technicianId)];
  }
  if (!techIds.length) return 0;

  const r = await crm.query(
    `SELECT DISTINCT d.dc_number
       FROM delivery_challan_lines d
      INNER JOIN delivery_technicians dt ON dt.technician_id = d.delivery_person_id
      WHERE d.delivery_person_id = ANY($1::int[])
        AND (
          COALESCE(jsonb_array_length(d.rejected_serial_numbers), 0) > 0
          OR COALESCE(jsonb_array_length(d.returned_serial_numbers), 0) > 0
          OR COALESCE(jsonb_array_length(d.pickuped_serial_numbers), 0) > 0
          OR d.status = 'pending'
        )`,
    [techIds]
  );
  return r.rows.length;
}

async function main() {
  const src = new ErpSqlDumpSource(resolveDumpPath());
  const dcs = src.getTableRows('delivery_challans');
  const dmen = src.getTableRows('delivery_men');
  const menIds = dmen.map((m) => m.id);

  console.log('=== ERP dump analysis (TechniciansBucketListController assets) ===');
  console.log('delivery_challans rows:', dcs.length);
  console.log('delivery_men:', dmen.length);
  console.log('ERP bucket (all technicians):', erpControllerAssets(dcs, menIds, 'all'));

  for (const dm of dmen.slice(0, 5)) {
    console.log(`  tech ${dm.id} (${dm.f_name} ${dm.l_name}):`, erpControllerAssets(dcs, menIds, String(dm.id)));
  }

  // Breakdown: why CRM might be higher
  const men = new Set(menIds.map(String));
  let invalidPerson = 0;
  let validPersonEligible = 0;
  let validPersonNotEligible = 0;
  const byDcErp = new Set();
  const byDcAnyPerson = new Set();

  for (const dc of dcs) {
    const pid = String(dc.delivery_person_id ?? '').trim();
    const hasJson = (v) => parseJsonArray(v).length > 0;
    const eligible =
      hasJson(dc.rejected_serial_numbers) ||
      hasJson(dc.returned_serial_numbers) ||
      hasJson(dc.pickuped_serial_numbers) ||
      String(dc.status || '').toLowerCase() === 'pending';
    if (!eligible || !dc.dc_number) continue;

    if (!pid || !/^\d+$/.test(pid) || !men.has(pid)) {
      invalidPerson += 1;
      continue;
    }
    validPersonEligible += 1;
    byDcErp.add(dc.dc_number);

    byDcAnyPerson.add(dc.dc_number);
  }

  for (const dc of dcs) {
    const hasJson = (v) => parseJsonArray(v).length > 0;
    const eligible =
      hasJson(dc.rejected_serial_numbers) ||
      hasJson(dc.returned_serial_numbers) ||
      hasJson(dc.pickuped_serial_numbers) ||
      String(dc.status || '').toLowerCase() === 'pending';
    if (eligible && dc.dc_number) byDcAnyPerson.add(dc.dc_number);
  }

  console.log('\nEligible lines with invalid/non-delivery_man person_id:', invalidPerson);
  console.log('Eligible lines with valid delivery_man person_id:', validPersonEligible);
  console.log('Distinct DC (ERP join logic):', byDcErp.size);

  const crm = getCrmPool();
  try {
    const current = await crmCurrentLogic(crm, 'all');
    const parity = await crmErpParityLogic(crm, 'all');
    console.log('\n=== CRM local DB ===');
    console.log('CRM current service logic (tech_id + user_id, outbound only):', current);
    console.log('CRM ERP-parity (technician_id only, inner join, no movement filter):', parity);

    const userIdExtra = await crm.query(`
      SELECT COUNT(DISTINCT d.dc_number) AS c
        FROM delivery_challan_lines d
       WHERE d.delivery_person_id IN (
         SELECT user_id FROM delivery_technicians WHERE user_id IS NOT NULL
       )
         AND d.delivery_person_id NOT IN (SELECT technician_id FROM delivery_technicians)
         AND COALESCE(d.movement_type, 'outbound') = 'outbound'
         AND (
           COALESCE(jsonb_array_length(d.rejected_serial_numbers), 0) > 0
           OR COALESCE(jsonb_array_length(d.returned_serial_numbers), 0) > 0
           OR COALESCE(jsonb_array_length(d.pickuped_serial_numbers), 0) > 0
           OR d.status = 'pending'
         )
    `);
    console.log('Extra DCs matched only via user_id (not technician_id):', userIdExtra.rows[0]?.c);

    const outboundOnly = await crm.query(`
      SELECT COUNT(DISTINCT d.dc_number) AS c
        FROM delivery_challan_lines d
       INNER JOIN delivery_technicians dt ON dt.technician_id = d.delivery_person_id
       WHERE COALESCE(d.movement_type, 'outbound') != 'outbound'
         AND (
           COALESCE(jsonb_array_length(d.rejected_serial_numbers), 0) > 0
           OR COALESCE(jsonb_array_length(d.returned_serial_numbers), 0) > 0
           OR COALESCE(jsonb_array_length(d.pickuped_serial_numbers), 0) > 0
           OR d.status = 'pending'
         )
    `);
    console.log('Non-outbound DCs in ERP-parity join:', outboundOnly.rows[0]?.c);

    const wrongPerson = await crm.query(`
      SELECT COUNT(DISTINCT d.dc_number) AS c
        FROM delivery_challan_lines d
       WHERE d.delivery_person_id IS NOT NULL
         AND d.delivery_person_id NOT IN (SELECT technician_id FROM delivery_technicians)
         AND COALESCE(d.movement_type, 'outbound') = 'outbound'
         AND (
           COALESCE(jsonb_array_length(d.rejected_serial_numbers), 0) > 0
           OR COALESCE(jsonb_array_length(d.returned_serial_numbers), 0) > 0
           OR COALESCE(jsonb_array_length(d.pickuped_serial_numbers), 0) > 0
           OR d.status = 'pending'
         )
    `);
    console.log('DCs with delivery_person_id not in delivery_technicians.technician_id:', wrongPerson.rows[0]?.c);
  } finally {
    await closePools();
    src.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
