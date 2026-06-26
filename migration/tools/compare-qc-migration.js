#!/usr/bin/env node
/**
 * Compare ERP vs CRM QC pending/passed serials record-by-record.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const { getCrmPool, closePools } = require('../lib/db');
const { createErpSource } = require('../lib/erpSource');
const { CRM_QC_PROCESS_COUNT_SQL } = require('../lib/qcStatusHelpers');

const EFFECTIVE = `COALESCE(NULLIF(TRIM(s.qc_status), ''), NULLIF(TRIM(s.extra->>'status'), ''), 'pending')`;
const OFF_SHELF = ['reserved', 'in_transit', 'rented', 'on_demo', 'sold', 'returned', 'scrapped'];

async function crmPassedStrict(crm) {
  const r = await crm.query(`
    SELECT COUNT(*)::int AS c FROM vendor_serial_numbers s
    INNER JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
    WHERE s.deleted_at IS NULL AND s.po_id IS NOT NULL AND ${EFFECTIVE} = 'passed'
  `);
  return r.rows[0].c;
}

async function crmPassedReadyToRent(crm) {
  const r = await crm.query(`
    SELECT COUNT(*)::int AS c FROM vendor_serial_numbers s
    INNER JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
    WHERE s.deleted_at IS NULL AND s.po_id IS NOT NULL AND ${EFFECTIVE} = 'passed'
      AND COALESCE(NULLIF(TRIM(s.inventory_status), ''), 'in_stock') <> ALL($1::text[])
  `, [OFF_SHELF]);
  return r.rows[0].c;
}

async function main() {
  const erp = await createErpSource();
  const crm = getCrmPool();

  const [erpPendingRows] = await erp.query("SELECT id, serial_number, unique_product_serial, status, po_id, goods_receipts_id FROM `serial_numbers` WHERE status = 'pending'");
  const [erpPassedRows] = await erp.query("SELECT id, serial_number, unique_product_serial, status, po_id, goods_receipts_id FROM `serial_numbers` WHERE status = 'passed'");

  const { rows: maps } = await crm.query(`SELECT erp_id, crm_id FROM erp_id_map WHERE entity = 'serial_numbers'`);
  const mapByErp = new Map(maps.map((m) => [Number(m.erp_id), Number(m.crm_id)]));

  async function analyzeErpRows(erpRows, statusLabel) {
    const missing = [];
    const wrongStatus = [];
    const noPo = [];
    const deleted = [];
    const ok = [];

    for (const row of erpRows) {
      const crmId = mapByErp.get(Number(row.id));
      if (!crmId) {
        missing.push({ reason: 'not_in_erp_id_map', erp: row });
        continue;
      }
      const { rows: crmRows } = await crm.query(
        `SELECT s.serial_id, s.serial_number, s.po_id, s.deleted_at, s.qc_status, s.inventory_status, s.extra,
                p.po_id AS po_exists
           FROM vendor_serial_numbers s
           LEFT JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
          WHERE s.serial_id = $1`,
        [crmId]
      );
      if (!crmRows.length) {
        missing.push({ reason: 'mapped_but_row_missing', erp: row, crmId });
        continue;
      }
      const s = crmRows[0];
      if (s.deleted_at) {
        deleted.push({ erp: row, crm: s });
        continue;
      }
      if (!s.po_id || !s.po_exists) {
        noPo.push({ erp: row, crm: s });
        continue;
      }
      const eff = (s.qc_status || s.extra?.status || 'pending').toLowerCase();
      if (eff !== statusLabel) {
        wrongStatus.push({ erp: row, crm: s, effective: eff });
        continue;
      }
      ok.push(row.id);
    }
    return { missing, wrongStatus, noPo, deleted, ok };
  }

  const pending = await analyzeErpRows(erpPendingRows, 'pending');
  const passed = await analyzeErpRows(erpPassedRows, 'passed');

  const crmPending = (await crm.query(CRM_QC_PROCESS_COUNT_SQL)).rows[0].c;
  const crmPassedAll = await crmPassedStrict(crm);
  const crmPassedRtr = await crmPassedReadyToRent(crm);

  console.log('\n=== Counts ===');
  console.log('ERP pending:', erpPendingRows.length);
  console.log('CRM pending (qc_process):', crmPending);
  console.log('ERP passed:', erpPassedRows.length);
  console.log('CRM passed (strict):', crmPassedAll);
  console.log('CRM passed (ready-to-rent filter):', crmPassedRtr);

  function report(label, data) {
    console.log(`\n=== ${label} ===`);
    console.log('OK:', data.ok.length);
    console.log('Missing/not mapped:', data.missing.length);
    console.log('Wrong QC status:', data.wrongStatus.length);
    console.log('No PO / deleted PO:', data.noPo.length);
    console.log('CRM row deleted:', data.deleted.length);
    if (data.missing.length) {
      console.log('Sample missing:');
      data.missing.slice(0, 10).forEach((m) => {
        console.log(`  ERP#${m.erp.id} sn=${m.erp.serial_number} po=${m.erp.po_id} grn=${m.erp.goods_receipts_id} reason=${m.reason}`);
      });
    }
    if (data.wrongStatus.length) {
      console.log('Sample wrong status:');
      data.wrongStatus.slice(0, 10).forEach((m) => {
        console.log(`  ERP#${m.erp.id} ERP=${m.erp.status} CRM=${m.effective} sn=${m.crm.serial_number}`);
      });
    }
    if (data.noPo.length) {
      console.log('Sample no PO:');
      data.noPo.slice(0, 10).forEach((m) => {
        console.log(`  ERP#${m.erp.id} crm_po_id=${m.crm.po_id} sn=${m.crm.serial_number}`);
      });
    }
  }

  report('PENDING gap analysis', pending);
  report('PASSED gap analysis', passed);

  // CRM rows in pending not in ERP pending
  const { rows: crmExtraPending } = await crm.query(`
    SELECT s.serial_id, s.serial_number, s.extra->>'erp_serial_id' AS erp_id, ${EFFECTIVE} AS eff
      FROM vendor_serial_numbers s
      INNER JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
     WHERE s.deleted_at IS NULL AND s.po_id IS NOT NULL AND ${EFFECTIVE} = 'pending'
     LIMIT 5000
  `);
  const erpPendingIds = new Set(erpPendingRows.map((r) => Number(r.id)));
  const crmOnlyPending = crmExtraPending.filter((r) => {
    const eid = r.erp_id ? Number(r.erp_id) : null;
    return !eid || !erpPendingIds.has(eid);
  });
  console.log('\nCRM pending rows not in ERP pending:', crmOnlyPending.length);
  crmOnlyPending.slice(0, 5).forEach((r) => console.log(`  crm#${r.serial_id} erp=${r.erp_id} sn=${r.serial_number} eff=${r.eff}`));

  await erp.close?.();
  await closePools();
}

main().catch((e) => { console.error(e); process.exit(1); });
