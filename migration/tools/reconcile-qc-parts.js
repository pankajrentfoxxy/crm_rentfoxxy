#!/usr/bin/env node
/**
 * Reconciliation report: ERP vs CRM for QC Process + Spare Parts.
 *
 * Usage:
 *   node tools/reconcile-qc-parts.js
 *   ERP_USE_SQL_DUMP=true node tools/reconcile-qc-parts.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { getCrmPool, closePools } = require('../lib/db');
const { createErpSource } = require('../lib/erpSource');
const { CRM_QC_PROCESS_COUNT_SQL } = require('../lib/qcStatusHelpers');

async function erpQcPending(erp) {
  const [rows] = await erp.query(
    "SELECT COUNT(*) AS cnt FROM `serial_numbers` WHERE status = 'pending'"
  );
  return Number(rows[0].cnt);
}


async function crmQcProcess(crm) {
  const r = await crm.query(CRM_QC_PROCESS_COUNT_SQL);
  return r.rows[0].c;
}

async function erpQcPassed(erp) {
  const [rows] = await erp.query(
    "SELECT COUNT(*) AS cnt FROM `serial_numbers` WHERE status = 'passed'"
  );
  return Number(rows[0].cnt);
}

async function crmQcPassed(crm) {
  const r = await crm.query(`
    SELECT COUNT(*)::int AS c
    FROM vendor_serial_numbers s
    INNER JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
    WHERE s.deleted_at IS NULL AND s.po_id IS NOT NULL
      AND COALESCE(NULLIF(TRIM(s.qc_status), ''), NULLIF(TRIM(s.extra->>'status'), ''), 'pending') = 'passed'
  `);
  return r.rows[0].c;
}

async function crmQcPassedErpMapped(crm) {
  const r = await crm.query(`
    SELECT COUNT(*)::int AS c
    FROM vendor_serial_numbers s
    INNER JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
    INNER JOIN erp_id_map m ON m.entity = 'serial_numbers' AND m.crm_id = s.serial_id
    WHERE s.deleted_at IS NULL AND s.po_id IS NOT NULL
      AND COALESCE(NULLIF(TRIM(s.qc_status), ''), NULLIF(TRIM(s.extra->>'status'), ''), 'pending') = 'passed'
  `);
  return r.rows[0].c;
}

async function main() {
  const erp = await createErpSource();
  const crm = getCrmPool();

  console.log('\n=== QC Process Reconciliation ===');
  console.log('ERP source:', erp.mode, erp.dumpPath || '(MySQL)');

  const erpPending = await erpQcPending(erp);
  const erpPassed = await erpQcPassed(erp);
  const crmPending = await crmQcProcess(crm);
  const crmPassed = await crmQcPassed(crm);
  const crmPassedMapped = await crmQcPassedErpMapped(crm);

  console.log('ERP QC Processing (status=pending):     ', erpPending);
  console.log('CRM QC Process bucket (pending only):   ', crmPending);
  console.log('Match ERP pending?', erpPending === crmPending ? 'YES' : 'NO — run module 031');
  console.log('ERP QC Passed (status=passed):          ', erpPassed);
  console.log('CRM passed bucket (all):                ', crmPassed);
  console.log('CRM passed (ERP-migrated rows only):    ', crmPassedMapped);
  console.log('Match ERP passed (migrated)?', erpPassed === crmPassedMapped ? 'YES' : 'NO — run module 031');
  if (crmPassed !== crmPassedMapped) {
    console.log('CRM-only passed rows (post-migration):  ', crmPassed - crmPassedMapped);
  }

  console.log('\n=== Spare Parts Reconciliation ===');
  const [erpSpo] = await erp.query('SELECT COUNT(*) AS cnt FROM spare_parts_po');
  const [erpSp] = await erp.query('SELECT COUNT(*) AS cnt FROM spare_parts');
  let erpSnp = 0;
  try {
    const [r] = await erp.query('SELECT COUNT(*) AS cnt FROM serial_number_parts');
    erpSnp = Number(r[0].cnt);
  } catch { /* */ }

  const tables = [
    'vendor_spare_parts_purchase_orders',
    'vendor_spare_parts_catalog',
    'parts',
  ];
  const crmCounts = {};
  for (const t of tables) {
    try {
      const r = await crm.query(`SELECT COUNT(*)::int c FROM ${t} WHERE deleted_at IS NULL OR true`);
      crmCounts[t] = r.rows[0].c;
    } catch {
      try {
        const r = await crm.query(`SELECT COUNT(*)::int c FROM ${t}`);
        crmCounts[t] = r.rows[0].c;
      } catch (e) {
        crmCounts[t] = `error: ${e.message}`;
      }
    }
  }

  const spareSerials = await crm.query(
    `SELECT COUNT(*)::int c FROM vendor_serial_numbers WHERE spo_id IS NOT NULL AND deleted_at IS NULL`
  );

  console.log('ERP spare_parts_po:                     ', Number(erpSpo[0].cnt));
  console.log('ERP spare_parts catalog:                ', Number(erpSp[0].cnt));
  console.log('ERP serial_number_parts:                ', erpSnp);
  console.log('CRM vendor_spare_parts_purchase_orders: ', crmCounts.vendor_spare_parts_purchase_orders);
  console.log('CRM vendor_spare_parts_catalog:       ', crmCounts.vendor_spare_parts_catalog);
  console.log('CRM parts (floor catalog):              ', crmCounts.parts);
  console.log('CRM vendor_serial_numbers (spo_id):     ', spareSerials.rows[0].c);
  console.log('Match ERP SPO count?', Number(erpSpo[0].cnt) === crmCounts.vendor_spare_parts_purchase_orders ? 'YES' : 'NO — run module 032');

  console.log('\n=== Notes ===');
  console.log('- ERP QC Processing = serial_numbers.status = pending');
  console.log('- CRM /inventory-management/qc-process must use the same filter (fixed in inventoryManagementService.js)');
  console.log('- CRM /inventory-management/parts uses `parts` table (floor catalog), not SPO headers');
  console.log('- Spare PO list: /vendor-management/spare-parts-po | Received serials: /inventory-management/spare-parts\n');

  await erp.close?.();
  await closePools();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
