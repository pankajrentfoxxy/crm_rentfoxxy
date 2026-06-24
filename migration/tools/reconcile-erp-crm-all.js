#!/usr/bin/env node
/**
 * Full ERP ↔ CRM reconciliation for PO, QC, SO, DC, Return DC, Delivery Register, Technician Bucket.
 *
 * Usage:
 *   node tools/reconcile-erp-crm-all.js
 *   node tools/reconcile-erp-crm-all.js --fix-report   # also write migration/docs/ERP_CRM_RECONCILIATION.json
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { getCrmPool, closePools } = require('../lib/db');
const { createErpSource } = require('../lib/erpSource');
const { CRM_QC_PROCESS_COUNT_SQL } = require('../lib/qcStatusHelpers');

const OFF_SHELF = ['reserved', 'in_transit', 'rented', 'on_demo', 'sold', 'returned', 'scrapped'];

function diffSets(erpIds, crmMappedErpIds) {
  const crmSet = new Set(crmMappedErpIds.map(String));
  const missing = erpIds.filter((id) => !crmSet.has(String(id)));
  const extra = crmMappedErpIds.filter((id) => !erpIds.includes(Number(id)) && !erpIds.includes(String(id)));
  return { missing, extra };
}

async function crmMappedErpIds(crm, entity) {
  const r = await crm.query(
    `SELECT erp_id::text AS id FROM erp_id_map WHERE entity = $1 ORDER BY erp_id::int`,
    [entity]
  );
  return r.rows.map((x) => x.id);
}

async function erpPoIds(erp) {
  const [rows] = await erp.query('SELECT id FROM `purchase_orders` ORDER BY id');
  return rows.map((r) => r.id);
}

async function erpQcPendingIds(erp) {
  const [rows] = await erp.query(
    "SELECT id FROM `serial_numbers` WHERE status = 'pending' ORDER BY id"
  );
  return rows.map((r) => r.id);
}

async function erpQcPassedIds(erp) {
  const [rows] = await erp.query(
    "SELECT id FROM `serial_numbers` WHERE status = 'passed' ORDER BY id"
  );
  return rows.map((r) => r.id);
}

async function crmQcPendingSerialIds(crm) {
  const r = await crm.query(`
    SELECT s.serial_id, s.extra->>'erp_serial_id' AS erp_id
    FROM vendor_serial_numbers s
    INNER JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
    WHERE s.deleted_at IS NULL AND s.po_id IS NOT NULL
      AND COALESCE(NULLIF(TRIM(s.qc_status), ''), NULLIF(TRIM(s.extra->>'status'), ''), 'pending') = 'pending'
    ORDER BY s.serial_id
  `);
  return r.rows;
}

async function crmQcPassedSerialIds(crm) {
  const r = await crm.query(`
    SELECT s.serial_id, s.extra->>'erp_serial_id' AS erp_id
    FROM vendor_serial_numbers s
    INNER JOIN vendor_purchase_orders p ON p.po_id = s.po_id AND p.deleted_at IS NULL
    WHERE s.deleted_at IS NULL AND s.po_id IS NOT NULL
      AND COALESCE(NULLIF(TRIM(s.qc_status), ''), NULLIF(TRIM(s.extra->>'status'), ''), 'pending') = 'passed'
      AND COALESCE(NULLIF(TRIM(s.inventory_status), ''), 'in_stock') <> ALL($1::text[])
    ORDER BY s.serial_id
  `, [OFF_SHELF]);
  return r.rows;
}

async function erpDistinctSoNumbers(erp) {
  const [rows] = await erp.query(
    'SELECT DISTINCT sales_order_number FROM `sales_orders` WHERE sales_order_number IS NOT NULL AND sales_order_number <> \'\' ORDER BY 1'
  );
  return rows.map((r) => r.sales_order_number);
}

async function crmDistinctSoNumbers(crm) {
  const r = await crm.query(
    `SELECT DISTINCT sales_order_number FROM sales_order_lines ORDER BY 1`
  );
  return r.rows.map((x) => x.sales_order_number);
}

async function erpSoLineIds(erp) {
  const [rows] = await erp.query('SELECT id, sales_order_number FROM `sales_orders` ORDER BY id');
  return rows;
}

async function erpDcIds(erp) {
  const [rows] = await erp.query('SELECT id FROM `delivery_challans` ORDER BY id');
  return rows.map((r) => r.id);
}

async function erpReturnDcKeys(erp) {
  // ERP view-return-dc: closed pickup complaints with POD
  const [rows] = await erp.query(`
    SELECT ct.id, ct.return_dc_number, ct.serial_number, ct.unique_number
    FROM complaints_ticket ct
    INNER JOIN pod_submissions ps ON ps.pickup_id = ct.id
    WHERE ct.complaint_type = 'pickup'
      AND ct.status = 'close'
      AND ps.pod_closed_at IS NOT NULL
    ORDER BY ct.id
  `);
  return rows;
}

async function crmReturnDcNumbers(crm) {
  const r = await crm.query(
    `SELECT dc_number, extra->>'erp_complaint_id' AS erp_id
     FROM delivery_challan_lines WHERE movement_type = 'return' ORDER BY dc_number`
  );
  return r.rows;
}

async function erpDrDcNumbers(erp, status) {
  const [rows] = await erp.query(
    'SELECT DISTINCT dc_number FROM `delivery_challans` WHERE status = ? ORDER BY dc_number',
    [status]
  );
  return rows.map((r) => r.dc_number);
}

async function crmDrDcNumbers(crm, status) {
  const r = await crm.query(
    `SELECT DISTINCT dc_number FROM delivery_challan_lines
     WHERE COALESCE(movement_type, 'outbound') = 'outbound' AND status = $1
     ORDER BY dc_number`,
    [status]
  );
  return r.rows.map((x) => x.dc_number);
}

async function erpTechnicianBucketDcNumbers(erp) {
  const [rows] = await erp.query(`
    SELECT DISTINCT dc_number FROM delivery_challans dc
    WHERE dc.delivery_person_id IS NOT NULL
      AND (
        JSON_LENGTH(dc.rejected_serial_numbers) > 0
        OR JSON_LENGTH(dc.returned_serial_numbers) > 0
        OR JSON_LENGTH(dc.pickuped_serial_numbers) > 0
        OR dc.status = 'pending'
      )
    ORDER BY dc_number
  `);
  return rows.map((r) => r.dc_number);
}

async function crmTechnicianBucketDcNumbers(crm) {
  const r = await crm.query(`
    SELECT DISTINCT dc_number FROM delivery_challan_lines d
    WHERE d.delivery_person_id IS NOT NULL
      AND COALESCE(d.movement_type, 'outbound') = 'outbound'
      AND (
        COALESCE(jsonb_array_length(d.rejected_serial_numbers), 0) > 0
        OR COALESCE(jsonb_array_length(d.returned_serial_numbers), 0) > 0
        OR COALESCE(jsonb_array_length(d.pickuped_serial_numbers), 0) > 0
        OR d.status = 'pending'
      )
    ORDER BY dc_number
  `);
  return r.rows.map((x) => x.dc_number);
}

async function diagnosePoSkip(erp, crm, erpId) {
  const [rows] = await erp.query('SELECT id, vendor_id, purchase_order_number FROM `purchase_orders` WHERE id = ?', [erpId]);
  if (!rows.length) return 'ERP row not found';
  const row = rows[0];
  const vendorMap = await crm.query(`SELECT crm_id FROM erp_id_map WHERE entity = 'vendors' AND erp_id = $1`, [String(row.vendor_id)]);
  if (!vendorMap.rows.length) return `vendor ${row.vendor_id} not mapped`;
  const poMap = await crm.query(`SELECT crm_id FROM erp_id_map WHERE entity = 'purchase_orders' AND erp_id = $1`, [String(erpId)]);
  if (!poMap.rows.length) {
    const byNum = await crm.query(
      `SELECT po_id FROM vendor_purchase_orders WHERE purchase_order_number = $1 AND deleted_at IS NULL LIMIT 1`,
      [row.purchase_order_number]
    );
    if (byNum.rows.length) return `dedupe by PO number ${row.purchase_order_number} — map not set`;
    return 'unknown — vendor mapped but PO not inserted';
  }
  return 'mapped';
}

async function diagnoseSoSkip(erp, crm, erpLineId) {
  const [rows] = await erp.query('SELECT id, customer_id, sales_order_number FROM `sales_orders` WHERE id = ?', [erpLineId]);
  if (!rows.length) return 'ERP row not found';
  const row = rows[0];
  const cust = await crm.query(`SELECT crm_id FROM erp_id_map WHERE entity = 'customers' AND erp_id = $1`, [String(row.customer_id)]);
  if (!cust.rows.length) return `customer ${row.customer_id} not mapped`;
  return 'customer mapped but line not migrated';
}

async function diagnoseDcSkip(erp, crm, erpId) {
  const [rows] = await erp.query('SELECT id, customer_id, dc_number FROM `delivery_challans` WHERE id = ?', [erpId]);
  if (!rows.length) return 'ERP row not found';
  const row = rows[0];
  const cust = await crm.query(`SELECT crm_id FROM erp_id_map WHERE entity = 'customers' AND erp_id = $1`, [String(row.customer_id)]);
  if (!cust.rows.length) return `customer ${row.customer_id} not mapped`;
  return 'customer mapped but DC line not migrated';
}

async function main() {
  const erp = await createErpSource();
  const crm = getCrmPool();
  const report = { generated_at: new Date().toISOString(), erp_source: erp.mode, modules: {} };

  console.log('\n========== ERP ↔ CRM FULL RECONCILIATION ==========');
  console.log('ERP source:', erp.mode, erp.dumpPath || '(MySQL)');

  // 1. Purchase Orders
  {
    const [erpCnt] = await erp.query('SELECT COUNT(*) AS c FROM `purchase_orders`');
    const crmCnt = await crm.query('SELECT COUNT(*)::int AS c FROM vendor_purchase_orders WHERE deleted_at IS NULL');
    const crmMapCnt = await crm.query(`SELECT COUNT(*)::int AS c FROM erp_id_map WHERE entity = 'purchase_orders'`);
    const erpIds = await erpPoIds(erp);
    const mapped = await crmMappedErpIds(crm, 'purchase_orders');
    const { missing } = diffSets(erpIds, mapped);
    const reasons = {};
    for (const id of missing.slice(0, 20)) {
      reasons[id] = await diagnosePoSkip(erp, crm, id);
    }
    report.modules.purchase_orders = {
      erp_count: Number(erpCnt[0].c),
      crm_count: crmCnt.rows[0].c,
      crm_mapped: crmMapCnt.rows[0].c,
      missing_erp_ids: missing,
      missing_reasons: reasons,
      verify_sql_erp: 'SELECT COUNT(*) FROM purchase_orders',
      verify_sql_crm: 'SELECT COUNT(*) FROM vendor_purchase_orders WHERE deleted_at IS NULL',
    };
    console.log('\n--- 1. Purchase Orders ---');
    console.log('ERP:', report.modules.purchase_orders.erp_count, '| CRM:', report.modules.purchase_orders.crm_count, '| Mapped:', report.modules.purchase_orders.crm_mapped);
    console.log('Missing ERP IDs:', missing.length ? missing.join(', ') : 'none');
    if (missing.length) console.log('Reasons:', reasons);
  }

  // 2. QC Pending
  {
    const [erpCnt] = await erp.query("SELECT COUNT(*) AS c FROM `serial_numbers` WHERE status = 'pending'");
    const crmCnt = await crm.query(CRM_QC_PROCESS_COUNT_SQL);
    const erpIds = await erpQcPendingIds(erp);
    const mapped = await crmMappedErpIds(crm, 'serial_numbers');
    const crmPending = await crmQcPendingSerialIds(crm);
    const crmPendingErpIds = crmPending.map((r) => r.erp_id).filter(Boolean);
    const missingFromMap = erpIds.filter((id) => !mapped.includes(String(id)));
    const missingInBucket = erpIds.filter((id) => {
      const m = mapped.includes(String(id));
      if (!m) return true;
      return !crmPendingErpIds.includes(String(id));
    });
    report.modules.qc_pending = {
      erp_count: Number(erpCnt[0].c),
      crm_count: crmCnt.rows[0].c,
      missing_not_mapped: missingFromMap,
      missing_not_in_bucket: missingInBucket,
      verify_sql_erp: "SELECT COUNT(*) FROM serial_numbers WHERE status='pending'",
      verify_sql_crm: CRM_QC_PROCESS_COUNT_SQL.trim(),
    };
    console.log('\n--- 2. QC Pending ---');
    console.log('ERP:', report.modules.qc_pending.erp_count, '| CRM:', report.modules.qc_pending.crm_count);
    console.log('Not mapped:', missingFromMap.join(', ') || 'none');
    console.log('Mapped but not in pending bucket:', missingInBucket.filter((id) => mapped.includes(String(id))).join(', ') || 'none');
  }

  // 3. QC Passed / Ready to Rent
  {
    const [erpCnt] = await erp.query("SELECT COUNT(*) AS c FROM `serial_numbers` WHERE status = 'passed'");
    const crmPassed = await crmQcPassedSerialIds(crm);
    const crmCnt = crmPassed.length;
    const erpIds = new Set((await erpQcPassedIds(erp)).map(String));
    const mapped = await crmMappedErpIds(crm, 'serial_numbers');
    const extraInCrm = crmPassed.filter((r) => r.erp_id && !erpIds.has(String(r.erp_id)));
    const missingErp = [...erpIds].filter((id) => !mapped.includes(id));
    report.modules.qc_passed = {
      erp_count: Number(erpCnt[0].c),
      crm_count: crmCnt,
      missing_erp_serial_ids: missingErp.slice(0, 50),
      extra_crm_serial_ids: extraInCrm.slice(0, 50).map((r) => ({ serial_id: r.serial_id, erp_id: r.erp_id })),
      verify_sql_erp: "SELECT COUNT(*) FROM serial_numbers WHERE status='passed'",
      verify_sql_crm: 'passed qc + on-shelf inventory_status + po_id (see inventoryManagementService.js)',
    };
    console.log('\n--- 3. QC Passed / Ready to Rent ---');
    console.log('ERP:', report.modules.qc_passed.erp_count, '| CRM (on-shelf passed):', report.modules.qc_passed.crm_count);
    console.log('Extra in CRM (erp_id not passed in ERP):', extraInCrm.length);
    console.log('Missing mapped ERP passed:', missingErp.length);
  }

  // 4. Sales Orders (distinct SO numbers — ERP UI count)
  {
    const erpNums = await erpDistinctSoNumbers(erp);
    const crmNums = await crmDistinctSoNumbers(crm);
    const erpSet = new Set(erpNums);
    const crmSet = new Set(crmNums);
    const missingNums = erpNums.filter((n) => !crmSet.has(n));
    const erpLines = await erpSoLineIds(erp);
    const mappedLines = await crmMappedErpIds(crm, 'sales_orders');
    const missingLineIds = erpLines.filter((r) => !mappedLines.includes(String(r.id))).map((r) => r.id);
    const lineReasons = {};
    for (const id of missingLineIds.slice(0, 30)) {
      lineReasons[id] = await diagnoseSoSkip(erp, crm, id);
    }
    report.modules.sales_orders = {
      erp_distinct_so_count: erpNums.length,
      crm_distinct_so_count: crmNums.length,
      erp_line_count: erpLines.length,
      crm_mapped_lines: mappedLines.length,
      missing_so_numbers: missingNums.slice(0, 50),
      missing_line_ids: missingLineIds,
      missing_line_reasons: lineReasons,
      verify_sql_erp: 'SELECT COUNT(DISTINCT sales_order_number) FROM sales_orders',
      verify_sql_crm: 'SELECT COUNT(DISTINCT sales_order_number) FROM sales_order_lines',
    };
    console.log('\n--- 4. Sales Orders ---');
    console.log('ERP distinct SO:', erpNums.length, '| CRM distinct SO:', crmNums.length);
    console.log('ERP lines:', erpLines.length, '| CRM mapped lines:', mappedLines.length);
    console.log('Missing line IDs:', missingLineIds.length, missingLineIds.slice(0, 20).join(', '));
  }

  // 5. Delivery Challans (row count — ERP view-dc)
  {
    const [erpCnt] = await erp.query('SELECT COUNT(*) AS c FROM `delivery_challans`');
    const crmCnt = await crm.query(
      `SELECT COUNT(*)::int AS c FROM delivery_challan_lines WHERE COALESCE(movement_type,'outbound')='outbound'`
    );
    const crmDistinct = await crm.query(
      `SELECT COUNT(DISTINCT dc_number)::int AS c FROM delivery_challan_lines WHERE COALESCE(movement_type,'outbound')='outbound'`
    );
    const erpIds = await erpDcIds(erp);
    const mapped = await crmMappedErpIds(crm, 'delivery_challans');
    const missing = erpIds.filter((id) => !mapped.includes(String(id)));
    const reasons = {};
    for (const id of missing.slice(0, 30)) {
      reasons[id] = await diagnoseDcSkip(erp, crm, id);
    }
    report.modules.delivery_challans = {
      erp_row_count: Number(erpCnt[0].c),
      crm_row_count: crmCnt.rows[0].c,
      crm_distinct_dc_count: crmDistinct.rows[0].c,
      missing_erp_ids: missing,
      missing_reasons: reasons,
      verify_sql_erp: 'SELECT COUNT(*) FROM delivery_challans',
      verify_sql_crm: "SELECT COUNT(*) FROM delivery_challan_lines WHERE movement_type='outbound'",
    };
    console.log('\n--- 5. Delivery Challans ---');
    console.log('ERP rows:', report.modules.delivery_challans.erp_row_count, '| CRM rows:', report.modules.delivery_challans.crm_row_count);
    console.log('Missing ERP DC IDs:', missing.length);
  }

  // 6. Return DC
  {
    const erpRows = await erpReturnDcKeys(erp);
    const crmRows = await crmReturnDcNumbers(crm);
    const erpIds = new Set(erpRows.map((r) => String(r.id)));
    const crmErpIds = new Set(crmRows.map((r) => r.erp_id).filter(Boolean));
    const missing = erpRows.filter((r) => !crmErpIds.has(String(r.id)));
    const crmCnt = await crm.query(`SELECT COUNT(DISTINCT dc_number)::int AS c FROM delivery_challan_lines WHERE movement_type='return'`);
    report.modules.return_dc = {
      erp_count: erpRows.length,
      crm_distinct_dc_count: crmCnt.rows[0].c,
      missing_complaint_ids: missing.map((r) => r.id),
      verify_sql_erp: 'complaints_ticket pickup+close with pod_submissions.pod_closed_at',
      verify_sql_crm: "COUNT(DISTINCT dc_number) FROM delivery_challan_lines WHERE movement_type='return'",
    };
    console.log('\n--- 6. Return DC ---');
    console.log('ERP:', erpRows.length, '| CRM distinct RDC:', crmCnt.rows[0].c);
    console.log('Missing complaint IDs:', missing.length, missing.slice(0, 15).map((r) => r.id).join(', '));
  }

  // 7. Delivery Register
  {
    const erpPending = await erpDrDcNumbers(erp, 'pending');
    const erpDelivered = await erpDrDcNumbers(erp, 'delivered');
    const crmPending = await crmDrDcNumbers(crm, 'pending');
    const crmDelivered = await crmDrDcNumbers(crm, 'delivered');
    const crmPendingWrong = await crm.query(
      `SELECT COUNT(DISTINCT dc_number)::int AS c FROM delivery_challan_lines
       WHERE COALESCE(movement_type,'outbound')='outbound' AND status IN ('in_transit','shipped','reached','processing')`
    );
    report.modules.delivery_register = {
      erp_in_transit: erpPending.length,
      crm_in_transit_pending: crmPending.length,
      crm_in_transit_non_pending_status: crmPendingWrong.rows[0].c,
      erp_delivered: erpDelivered.length,
      crm_delivered: crmDelivered.length,
      missing_in_transit: erpPending.filter((n) => !crmPending.includes(n)).slice(0, 30),
      missing_delivered: erpDelivered.filter((n) => !crmDelivered.includes(n)).slice(0, 30),
      extra_delivered: crmDelivered.filter((n) => !erpDelivered.includes(n)).slice(0, 30),
      verify_sql_erp: "SELECT COUNT(DISTINCT dc_number) FROM delivery_challans WHERE status='pending'|'delivered'",
      verify_sql_crm: "Same on delivery_challan_lines outbound",
    };
    console.log('\n--- 7. Delivery Register ---');
    console.log('In Transit — ERP pending DCs:', erpPending.length, '| CRM status=pending:', crmPending.length, '| CRM in_transit/shipped etc:', crmPendingWrong.rows[0].c);
    console.log('Delivered — ERP:', erpDelivered.length, '| CRM:', crmDelivered.length);
  }

  // 8. Technician Bucket
  {
    const erpDcs = await erpTechnicianBucketDcNumbers(erp);
    const crmDcs = await crmTechnicianBucketDcNumbers(crm);
    const erpSet = new Set(erpDcs);
    const crmSet = new Set(crmDcs);
    report.modules.technician_bucket = {
      erp_distinct_dc_count: erpDcs.length,
      crm_distinct_dc_count: crmDcs.length,
      missing_dc_numbers: erpDcs.filter((n) => !crmSet.has(n)).slice(0, 30),
      extra_dc_numbers: crmDcs.filter((n) => !erpSet.has(n)).slice(0, 30),
    };
    console.log('\n--- 8. Technician Bucket ---');
    console.log('ERP distinct DCs:', erpDcs.length, '| CRM:', crmDcs.length);
  }

  if (process.argv.includes('--fix-report')) {
    const out = path.join(__dirname, '..', 'docs', 'ERP_CRM_RECONCILIATION.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log('\nReport written:', out);
  }

  await erp.close();
  await closePools();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
