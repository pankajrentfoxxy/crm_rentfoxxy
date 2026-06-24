#!/usr/bin/env node
/**
 * Technician bucket gap audit + delivery person mapping report.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { getCrmPool, closePools, getErpPool } = require('../lib/db');
const { ErpSqlDumpSource, resolveDumpPath } = require('../lib/erpSqlDumpSource');
const { parseJson } = require('../lib/helpers');

function parseJsonArray(raw) {
  const parsed = parseJson(raw, null);
  if (Array.isArray(parsed)) return parsed;
  if (parsed != null) return [parsed];
  return [];
}

function erpBucketEligible(dc) {
  if (!dc.delivery_person_id || !/^\d+$/.test(String(dc.delivery_person_id).trim())) return false;
  const hasJson = (v) => parseJsonArray(v).length > 0;
  return (
    hasJson(dc.rejected_serial_numbers) ||
    hasJson(dc.returned_serial_numbers) ||
    hasJson(dc.pickuped_serial_numbers) ||
    String(dc.status || '').toLowerCase() === 'pending'
  );
}

function erpBucketDcNumbers(rows, deliveryMenIds) {
  const men = new Set(deliveryMenIds.map(String));
  const set = new Set();
  for (const dc of rows) {
    const pid = String(dc.delivery_person_id ?? '');
    if (!men.has(pid) || !erpBucketEligible(dc) || !dc.dc_number) continue;
    set.add(String(dc.dc_number));
  }
  return set;
}

async function loadErpRows(mode) {
  if (mode === 'mysql') {
    const pool = await getErpPool();
    const [dcs] = await pool.query(`
      SELECT id, dc_number, delivery_person_id, status,
             rejected_serial_numbers, returned_serial_numbers,
             pickuped_serial_numbers, old_pickuped_serial_numbers
        FROM delivery_challans
    `);
    const [dmen] = await pool.query('SELECT id, f_name, l_name, email, phone, is_active FROM delivery_men');
    return { dcs, dmen, close: () => pool.end() };
  }
  const src = new ErpSqlDumpSource(resolveDumpPath());
  return {
    dcs: src.getTableRows('delivery_challans'),
    dmen: src.getTableRows('delivery_men'),
    close: () => src.end(),
  };
}

async function crmBucketDcNumbers(crm) {
  const r = await crm.query(`
    SELECT DISTINCT d.dc_number
      FROM delivery_challan_lines d
     INNER JOIN delivery_technicians dt ON dt.technician_id = d.delivery_person_id
     WHERE (
       COALESCE(jsonb_array_length(d.rejected_serial_numbers), 0) > 0
       OR COALESCE(jsonb_array_length(d.returned_serial_numbers), 0) > 0
       OR COALESCE(jsonb_array_length(d.pickuped_serial_numbers), 0) > 0
       OR d.status = 'pending'
     )
  `);
  return new Set(r.rows.map((x) => String(x.dc_number)));
}

async function crmServiceBucketCount(crm, technicianId = 'all') {
  let techIds;
  if (technicianId === 'all' || !technicianId) {
    const r = await crm.query(`SELECT technician_id FROM delivery_technicians`);
    techIds = r.rows.map((row) => Number(row.technician_id));
  } else {
    techIds = [Number(technicianId)];
  }
  if (!techIds.length) return { personIds: [], count: 0 };

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
  return { personIds: techIds, count: r.rows.length };
}

async function auditMissing(crm, erpDcs, missingDcNumbers) {
  const report = [];
  for (const dcNum of missingDcNumbers) {
    const erpRows = erpDcs.filter((r) => String(r.dc_number) === dcNum);
    const first = erpRows[0] || {};
    const erpIds = erpRows.map((r) => r.id);
    const erpPersonId = first.delivery_person_id;

    const crmLines = await crm.query(
      `SELECT d.id, d.dc_number, d.delivery_person_id, d.status, d.movement_type,
              m.erp_id,
              dt.technician_id, dt.user_id AS dt_user_id, dt.is_active AS dt_active,
              dt.first_name, dt.last_name, u.user_id, u.name AS user_name
         FROM delivery_challan_lines d
         LEFT JOIN erp_id_map m ON m.entity = 'delivery_challans' AND m.crm_id::bigint = d.id
         LEFT JOIN delivery_technicians dt ON (
           dt.technician_id = d.delivery_person_id OR dt.user_id = d.delivery_person_id
         )
         LEFT JOIN users u ON u.user_id = d.delivery_person_id
        WHERE d.dc_number = $1`,
      [dcNum]
    );

    const dmMap = await crm.query(
      `SELECT crm_id FROM erp_id_map WHERE entity = 'delivery_men' AND erp_id = $1`,
      [String(erpPersonId ?? '')]
    );
    const techByErp = dmMap.rows[0]?.crm_id
      ? await crm.query(
          `SELECT technician_id, user_id, is_active, first_name, last_name, email
             FROM delivery_technicians WHERE technician_id = $1`,
          [Number(dmMap.rows[0].crm_id)]
        )
      : { rows: [] };

    let reason = 'unknown';
    if (!crmLines.rows.length) reason = 'DC line not migrated to CRM';
    else if (!erpPersonId) reason = 'ERP delivery_person_id is null';
    else if (!dmMap.rows.length) reason = 'ERP delivery_man not mapped in erp_id_map (entity=delivery_technicians)';
    else if (!techByErp.rows.length) reason = 'Mapped technician_id missing from delivery_technicians';
    else if (techByErp.rows[0].is_active === false) reason = 'Technician exists but is_active=FALSE';
    else {
      const line = crmLines.rows[0];
      const svcIds = await crm.query(
        `SELECT technician_id, user_id FROM delivery_technicians WHERE is_active = TRUE`
      );
      const allowed = new Set();
      for (const t of svcIds.rows) {
        allowed.add(Number(t.technician_id));
        if (t.user_id) allowed.add(Number(t.user_id));
      }
      if (!allowed.has(Number(line.delivery_person_id))) {
        reason = `delivery_person_id=${line.delivery_person_id} not in active technician person-id set`;
      } else reason = 'Should appear — check grouping/filter edge case';
    }

    report.push({
      dc_number: dcNum,
      erp_ids: erpIds,
      erp_delivery_person_id: erpPersonId,
      crm_lines: crmLines.rows.length,
      crm_delivery_person_id: crmLines.rows[0]?.delivery_person_id ?? null,
      erp_id_map_technician_crm_id: dmMap.rows[0]?.crm_id ?? null,
      technician: techByErp.rows[0] ?? null,
      crm_line_sample: crmLines.rows[0] ?? null,
      exclusion_reason: reason,
    });
  }
  return report;
}

async function main() {
  const crm = getCrmPool();
  let erpMode = 'dump';
  let erp;
  try {
    const pool = await getErpPool();
    await pool.query('SELECT 1');
    erpMode = 'mysql';
    const [dcs] = await pool.query(`
      SELECT id, dc_number, delivery_person_id, status,
             rejected_serial_numbers, returned_serial_numbers,
             pickuped_serial_numbers, old_pickuped_serial_numbers
        FROM delivery_challans
    `);
    const [dmen] = await pool.query('SELECT id, f_name, l_name, email, phone, is_active FROM delivery_men');
    erp = { dcs, dmen, close: () => pool.end() };
    console.log('ERP source: LIVE MySQL');
  } catch (e) {
    console.log('ERP source: SQL dump (' + e.code + ')');
    erp = await loadErpRows('dump');
  }

  const erpSet = erpBucketDcNumbers(erp.dcs, erp.dmen.map((m) => m.id));
  const crmSet = await crmBucketDcNumbers(crm);
  const svc = await crmServiceBucketCount(crm, 'all');

  const missing = [...erpSet].filter((n) => !crmSet.has(n)).sort();
  const extra = [...crmSet].filter((n) => !erpSet.has(n)).sort();

  console.log('\n=== Technician Bucket ===');
  console.log('ERP eligible distinct DC:', erpSet.size);
  console.log('CRM raw query distinct DC:', crmSet.size);
  console.log('CRM service-layer count (all techs):', svc.count);

  const missingReport = await auditMissing(crm, erp.dcs, missing);
  console.log('\nMissing DCs:', missing.length);
  for (const row of missingReport) {
    console.log(JSON.stringify(row, null, 2));
  }

  // Delivery person mapping audit
  const activeErpMen = erp.dmen.filter((m) => m.is_active == 1 || m.is_active === true || m.is_active === '1');
  const mapped = await crm.query(
    `SELECT erp_id, crm_id FROM erp_id_map WHERE entity = 'delivery_men'`
  );
  const mapByErp = new Map(mapped.rows.map((r) => [String(r.erp_id), r.crm_id]));
  const broken = [];
  for (const dm of activeErpMen) {
    const crmId = mapByErp.get(String(dm.id));
    if (!crmId) {
      broken.push({ erp_id: dm.id, issue: 'not_mapped', name: `${dm.f_name} ${dm.l_name}` });
      continue;
    }
    const tech = await crm.query(
      `SELECT technician_id, user_id, is_active, email FROM delivery_technicians WHERE technician_id = $1`,
      [Number(crmId)]
    );
    if (!tech.rows.length) {
      broken.push({ erp_id: dm.id, crm_id: crmId, issue: 'map_points_to_missing_row' });
    } else if (!tech.rows[0].is_active) {
      broken.push({ erp_id: dm.id, crm_id: crmId, issue: 'inactive_in_crm', tech: tech.rows[0] });
    }
  }

  console.log('\n=== Delivery person mapping gaps (active ERP delivery_men) ===');
  console.log('Active ERP delivery_men:', activeErpMen.length);
  console.log('Mapped in CRM:', mapped.rows.length);
  console.log('Broken mappings:', broken.length);
  for (const b of broken.slice(0, 30)) console.log(b);

  const out = {
    generated_at: new Date().toISOString(),
    erp_source: erpMode,
    counts: { erp: erpSet.size, crm_raw: crmSet.size, crm_service: svc.count },
    missing_dc_numbers: missing,
    extra_dc_numbers: extra,
    missing_detail: missingReport,
    broken_delivery_man_mappings: broken,
  };

  const outPath = path.join(__dirname, '..', 'docs', 'technician-bucket-audit.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log('\nWrote', outPath);

  await erp.close();
  await closePools();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
