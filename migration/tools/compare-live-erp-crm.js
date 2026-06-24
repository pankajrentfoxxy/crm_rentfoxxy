#!/usr/bin/env node
/**
 * Compare ERP Live MySQL vs SQL dump vs CRM for key modules.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { getCrmPool, closePools, getErpPool } = require('../lib/db');
const { ErpSqlDumpSource, resolveDumpPath } = require('../lib/erpSqlDumpSource');
const { parseJson } = require('../lib/helpers');

function parseJsonArray(raw) {
  const p = parseJson(raw, null);
  return Array.isArray(p) ? p : p != null ? [p] : [];
}

function bucketEligible(dc) {
  const hasJson = (v) => parseJsonArray(v).length > 0;
  return (
    hasJson(dc.rejected_serial_numbers) ||
    hasJson(dc.returned_serial_numbers) ||
    hasJson(dc.pickuped_serial_numbers) ||
    hasJson(dc.old_pickuped_serial_numbers) ||
    String(dc.status || '').toLowerCase() === 'pending'
  );
}

function erpTechnicianBucket(rows, deliveryMenIds) {
  const men = new Set(deliveryMenIds.map(Number));
  const set = new Set();
  for (const dc of rows) {
    const pid = Number(dc.delivery_person_id);
    if (!men.has(pid) || !bucketEligible(dc) || !dc.dc_number) continue;
    set.add(String(dc.dc_number));
  }
  return set.size;
}

function erpReturnDcPairs(rows) {
  const pairs = new Set();
  for (const row of rows) {
    for (const src of [row.pickuped_serial_numbers, row.old_pickuped_serial_numbers]) {
      for (const item of parseJsonArray(src)) {
        const parts = String(item).split('|');
        if (parts[1] && parts[2]) pairs.add(`${parts[1]}-${parts[2]}`);
      }
    }
  }
  return pairs.size;
}

async function loadDump() {
  const src = new ErpSqlDumpSource(resolveDumpPath());
  return {
    source: 'dump',
    purchase_orders: src.getTableRows('purchase_orders').length,
    qc_pending: src.getTableRows('serial_numbers').filter((r) => String(r.status).toLowerCase() === 'pending').length,
    qc_passed: src.getTableRows('serial_numbers').filter((r) => String(r.status).toLowerCase() === 'passed').length,
    sales_orders_distinct: new Set(src.getTableRows('sales_orders').map((r) => r.sales_order_number)).size,
    sales_order_lines: src.getTableRows('sales_orders').length,
    delivery_challans: src.getTableRows('delivery_challans').length,
    return_dc_pairs: erpReturnDcPairs(src.getTableRows('delivery_challans')),
    dr_in_transit: src.getTableRows('delivery_challans').filter((r) => String(r.status).toLowerCase() === 'pending').length,
    dr_delivered: new Set(
      src.getTableRows('delivery_challans')
        .filter((r) => String(r.status).toLowerCase() === 'delivered')
        .map((r) => r.dc_number)
    ).size,
    technician_bucket: erpTechnicianBucket(
      src.getTableRows('delivery_challans'),
      src.getTableRows('delivery_men').map((m) => m.id)
    ),
  };
}

async function loadLiveMysql() {
  const pool = await getErpPool();
  const q = async (sql) => {
    const [rows] = await pool.query(sql);
    return rows;
  };
  const [po] = await q('SELECT COUNT(*) AS c FROM purchase_orders');
  const [qcP] = await q("SELECT COUNT(*) AS c FROM serial_numbers WHERE status='pending'");
  const [qcPass] = await q("SELECT COUNT(*) AS c FROM serial_numbers WHERE status='passed'");
  const [soD] = await q('SELECT COUNT(DISTINCT sales_order_number) AS c FROM sales_orders');
  const [soL] = await q('SELECT COUNT(*) AS c FROM sales_orders');
  const [dc] = await q('SELECT COUNT(*) AS c FROM delivery_challans');
  const dcs = await q(`SELECT dc_number, delivery_person_id, status, rejected_serial_numbers, returned_serial_numbers, pickuped_serial_numbers, old_pickuped_serial_numbers FROM delivery_challans`);
  const dmen = await q('SELECT id FROM delivery_men');
  const [drP] = await q("SELECT COUNT(*) AS c FROM delivery_challans WHERE status='pending'");
  const drD = await q("SELECT DISTINCT dc_number FROM delivery_challans WHERE status='delivered'");
  await pool.end();
  return {
    source: 'live_mysql',
    purchase_orders: Number(po.c),
    qc_pending: Number(qcP.c),
    qc_passed: Number(qcPass.c),
    sales_orders_distinct: Number(soD.c),
    sales_order_lines: Number(soL.c),
    delivery_challans: Number(dc.c),
    return_dc_pairs: erpReturnDcPairs(dcs),
    dr_in_transit: Number(drP.c),
    dr_delivered: drD.length,
    technician_bucket: erpTechnicianBucket(dcs, dmen.map((m) => m.id)),
  };
}

async function loadLiveViaSsh() {
  const key = process.env.VPS_SSH_KEY;
  const host = process.env.VPS_HOST;
  if (!key || !host || !fs.existsSync(key)) return null;

  const sql = `
SELECT 'purchase_orders' m, COUNT(*) c FROM purchase_orders
UNION ALL SELECT 'qc_pending', COUNT(*) FROM serial_numbers WHERE status='pending'
UNION ALL SELECT 'qc_passed', COUNT(*) FROM serial_numbers WHERE status='passed'
UNION ALL SELECT 'so_distinct', COUNT(DISTINCT sales_order_number) FROM sales_orders
UNION ALL SELECT 'so_lines', COUNT(*) FROM sales_orders
UNION ALL SELECT 'delivery_challans', COUNT(*) FROM delivery_challans
UNION ALL SELECT 'dr_in_transit', COUNT(*) FROM delivery_challans WHERE status='pending'
UNION ALL SELECT 'dr_delivered', COUNT(DISTINCT dc_number) FROM delivery_challans WHERE status='delivered';
`.trim();

  const cmd = `ssh -i "${key}" -o StrictHostKeyChecking=no ${host} "mysql -N -B erp_rentfoxxy -e \\"${sql.replace(/"/g, '\\"')}\\""`;
  const r = spawnSync(cmd, { shell: true, encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) {
    console.warn('SSH MySQL failed:', r.stderr?.slice(0, 200));
    return null;
  }
  const out = {};
  for (const line of (r.stdout || '').trim().split('\n')) {
    const [m, c] = line.split('\t');
    out[m] = Number(c);
  }
  return {
    source: 'live_ssh',
    purchase_orders: out.purchase_orders,
    qc_pending: out.qc_pending,
    qc_passed: out.qc_passed,
    sales_orders_distinct: out.so_distinct,
    sales_order_lines: out.so_lines,
    delivery_challans: out.delivery_challans,
    dr_in_transit: out.dr_in_transit,
    dr_delivered: out.dr_delivered,
    return_dc_pairs: null,
    technician_bucket: null,
  };
}

async function loadCrm() {
  const c = getCrmPool();
  const [po, qcP, qcPass, so, soL, dc, drP, drD, tb] = await Promise.all([
    c.query('SELECT COUNT(*)::int c FROM vendor_purchase_orders WHERE deleted_at IS NULL'),
    c.query(`SELECT COUNT(*)::int c FROM vendor_serial_numbers s INNER JOIN vendor_purchase_orders p ON p.po_id=s.po_id AND p.deleted_at IS NULL WHERE s.deleted_at IS NULL AND s.po_id IS NOT NULL AND COALESCE(NULLIF(TRIM(s.qc_status),''), NULLIF(TRIM(s.extra->>'status'),''), 'pending')='pending'`),
    c.query(`SELECT COUNT(*)::int c FROM vendor_serial_numbers s INNER JOIN vendor_purchase_orders p ON p.po_id=s.po_id AND p.deleted_at IS NULL WHERE s.deleted_at IS NULL AND s.po_id IS NOT NULL AND COALESCE(NULLIF(TRIM(s.qc_status),''), NULLIF(TRIM(s.extra->>'status'),''), 'pending')='passed'`),
    c.query('SELECT COUNT(DISTINCT sales_order_number)::int c FROM sales_order_lines'),
    c.query("SELECT COUNT(*)::int c FROM erp_id_map WHERE entity='sales_orders'"),
    c.query("SELECT COUNT(*)::int c FROM delivery_challan_lines WHERE COALESCE(movement_type,'outbound')='outbound'"),
    c.query("SELECT COUNT(*)::int c FROM delivery_challan_lines WHERE COALESCE(movement_type,'outbound')='outbound' AND status='pending'"),
    c.query("SELECT COUNT(DISTINCT dc_number)::int c FROM delivery_challan_lines WHERE COALESCE(movement_type,'outbound')='outbound' AND status='delivered'"),
    c.query(`
      SELECT COUNT(DISTINCT d.dc_number)::int c
      FROM delivery_challan_lines d
      WHERE d.delivery_person_id IN (SELECT technician_id FROM delivery_technicians)
        AND COALESCE(d.movement_type,'outbound')='outbound'
        AND (
          COALESCE(jsonb_array_length(d.rejected_serial_numbers),0)>0
          OR COALESCE(jsonb_array_length(d.returned_serial_numbers),0)>0
          OR COALESCE(jsonb_array_length(d.pickuped_serial_numbers),0)>0
          OR d.status='pending'
        )`),
  ]);

  const pairs = await c.query(`
    SELECT pickuped_serial_numbers FROM delivery_challan_lines
    WHERE COALESCE(movement_type,'outbound')='outbound'
      AND COALESCE(jsonb_array_length(pickuped_serial_numbers),0)>0
  `);
  const set = new Set();
  for (const row of pairs.rows) {
    for (const item of parseJsonArray(row.pickuped_serial_numbers)) {
      const parts = String(item).split('|');
      if (parts[1] && parts[2]) set.add(`${parts[1]}-${parts[2]}`);
    }
  }

  return {
    source: 'crm',
    purchase_orders: po.rows[0].c,
    qc_pending: qcP.rows[0].c,
    qc_passed: qcPass.rows[0].c,
    sales_orders_distinct: so.rows[0].c,
    sales_order_lines: soL.rows[0].c,
    delivery_challans: dc.rows[0].c,
    return_dc_pairs: set.size,
    dr_in_transit: drP.rows[0].c,
    dr_delivered: drD.rows[0].c,
    technician_bucket: tb.rows[0].c,
  };
}

async function main() {
  const dump = await loadDump();
  let live = null;
  try {
    live = await loadLiveMysql();
    console.log('Connected: local ERP MySQL');
  } catch {
    live = await loadLiveViaSsh();
    if (live) console.log('Connected: ERP via VPS SSH');
    else console.log('Live ERP unavailable — dump + CRM only');
  }
  const crm = await loadCrm();

  const modules = [
    'purchase_orders', 'qc_pending', 'qc_passed', 'sales_orders_distinct',
    'sales_order_lines', 'delivery_challans', 'return_dc_pairs',
    'dr_in_transit', 'dr_delivered', 'technician_bucket',
  ];

  console.log('\n| Module | ERP Live | ERP Dump | CRM |');
  console.log('|--------|----------|----------|-----|');
  for (const m of modules) {
    const lv = live?.[m] ?? '—';
    console.log(`| ${m} | ${lv} | ${dump[m]} | ${crm[m]} |`);
  }

  const report = { generated_at: new Date().toISOString(), erp_live: live, erp_dump: dump, crm, technician_bucket_fix: {
    root_cause: 'CRM stored raw ERP delivery_man IDs; bucket service matched CRM technician_id. Invalid ERP ids (by_courier, unmapped) were counted incorrectly.',
    fixes: ['039_delivery_person_remap.js', '040_delivery_person_erp_sync.js', '020_delivery_challans.js remap on insert', 'techniciansBucketService.js all-technician filter + outbound scope'],
    final_count: { erp: dump.technician_bucket, crm: crm.technician_bucket },
  }};

  const outPath = path.join(__dirname, '..', 'docs', 'ERP_CRM_LIVE_COMPARISON.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log('\nWrote', outPath);

  await closePools();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
